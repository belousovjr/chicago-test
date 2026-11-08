"""Road topology, pavement, lamps, signals and crossings."""
import math
from collections import Counter, defaultdict
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union, linemerge, nearest_points
from shapely.strtree import STRtree
from chicago_geometry import snap_outline, triangles

def clean_roads(roads,bounds):
    lines=[LineString(r['points']) for r in roads]
    tree=STRtree(lines)
    joined=[]
    for i,line in enumerate(lines):
        points=list(line.coords)
        for end in [0,-1]:
            point=Point(points[end])
            neighbours=[lines[j] for j in tree.query(point.buffer(12)) if j!=i]
            if not neighbours:continue
            if any(other.distance(point)<=.01 for other in neighbours):continue
            previous=points[1] if end==0 else points[-2]
            vx,vz=point.x-previous[0],point.y-previous[1]
            targets=[]
            for other in neighbours:
                target=nearest_points(point,other)[1]
                distance=point.distance(target)
                forward=(target.x-point.x)*vx+(target.y-point.y)*vz
                if distance<=12 and forward>.1*distance*math.hypot(vx,vz):targets.append((distance,target))
            if targets:
                target=min(targets,key=lambda item:item[0])[1].coords[0]
                if end==0:points.insert(0,target)
                else:points.append(target)
        joined.append(LineString(points))
    network=unary_union(joined)
    merged=linemerge(network) if network.geom_type=='MultiLineString' else network
    paths=list(merged.geoms) if hasattr(merged,'geoms') else [merged]
    degrees=Counter(tuple(p) for line in paths for p in [line.coords[0],line.coords[-1]])
    keep=[]
    for line in paths:
        ends=[tuple(line.coords[0]),tuple(line.coords[-1])]
        leaf=any(degrees[p]==1 and bounds.boundary.distance(Point(p))>.5 for p in ends)
        direct=Point(ends[0]).distance(Point(ends[1]))
        redundant=direct<12 and line.length>2*direct
        if not (line.length<60 and (leaf or redundant)):keep.append(line)
    network=unary_union(keep)
    result=[]
    for road,line in zip(roads,joined):
        clipped=line.intersection(network)
        for part in (list(clipped.geoms) if hasattr(clipped,'geoms') else [clipped]):
            if part.geom_type=='LineString' and part.length>.01:
                result.append(dict(road,points=[list(p) for p in part.coords]))
    return result

def street_surfaces(roads,bounds):
    asphalt=unary_union([LineString(r['points']).simplify(0.3).buffer(r['width']/2,cap_style=2,join_style=3) for r in roads])
    # Close narrow notches with bevels instead of preserving pointed OSM leftovers.
    asphalt=asphalt.buffer(1.2,quad_segs=1,join_style=3).buffer(-1.2,quad_segs=1,join_style=3)
    asphalt=snap_outline(asphalt.simplify(0.6).intersection(bounds))
    polygons=list(asphalt.geoms) if hasattr(asphalt,'geoms') else [asphalt]
    asphalt=max(polygons,key=lambda p:p.area)
    # Tiny enclosed holes become asphalt, not miniature pedestrian islands.
    asphalt=Polygon(asphalt.exterior,[ring for ring in asphalt.interiors if Polygon(ring).area>=64])
    pavement=snap_outline(asphalt.buffer(3.2,join_style=3).intersection(bounds))
    return asphalt,pavement.difference(asphalt),pavement

def street_lamps(roads,sidewalks,asphalt):
    safe=sidewalks.buffer(-.25)
    if safe.is_empty:return []
    lamps=[]
    for road in roads:
        if road['bridge']:continue
        for a,b in zip(road['points'],road['points'][1:]):
            dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz)
            if length<=45:continue
            nx,nz=-dz/length,dx/length
            for distance in range(25,int(length-20),85):
                side=road['width']/2+.6
                desired=Point(a[0]+dx*distance/length+nx*side,a[1]+dz*distance/length+nz*side)
                point=nearest_points(desired,safe)[1]
                if desired.distance(point)>4 or point.distance(asphalt)>1.2:continue
                if any(point.distance(Point(lamp['position'][0],lamp['position'][2]))<8 for lamp in lamps):continue
                road_edge=nearest_points(point,asphalt)[1]
                lamps.append(dict(templateId='lamp',position=[point.x,.16,point.y],yaw=-math.atan2(road_edge.y-point.y,road_edge.x-point.x)))
    return lamps

def road_arms(origin,roads,lines,tree):
    arms=[]
    for index in tree.query(origin.buffer(.1)):
        index=int(index);line=lines[index];road=roads[index]
        if line.distance(origin)>.1:continue
        distance=line.project(origin)
        for sign in [-1,1]:
            sample=line.interpolate(max(0,min(line.length,distance+sign*8)))
            dx,dz=sample.x-origin.x,sample.y-origin.y;length=math.hypot(dx,dz)
            if length<1:continue
            direction=[dx/length,dz/length];one=road.get('oneway','no')
            incoming=one not in ['yes','1','true','-1'] or (sign<0 if one!='-1' else sign>0)
            previous=next((a for a in arms if sum(x*y for x,y in zip(a['direction'],direction))>.98),None)
            if previous:
                previous['width']=max(previous['width'],road['width']);previous['incoming']|=incoming
                previous['twoWay']|=one not in ['yes','1','true','-1']
            else:arms.append(dict(direction=direction,width=road['width'],incoming=incoming,twoWay=one not in ['yes','1','true','-1']))
    return arms

def traffic_signals(roads,sidewalks,asphalt):
    roads=[r for r in roads if r.get('highway') in ['primary','secondary','trunk','tertiary']]
    if not roads:return []
    lines=[LineString(r['points']) for r in roads]
    network=unary_union(lines)
    parts=list(network.geoms) if hasattr(network,'geoms') else [network]
    junctions=defaultdict(list)
    for line in parts:
        if line.geom_type!='LineString' or line.length<2:continue
        for reverse in [False,True]:
            path=LineString(list(line.coords)[::-1]) if reverse else line
            origin=Point(path.coords[0]);sample=path.interpolate(min(8,path.length))
            dx,dz=sample.x-origin.x,sample.y-origin.y;length=math.hypot(dx,dz)
            junctions[origin.coords[0]].append((dx/length,dz/length))
    safe=sidewalks.buffer(-.3).difference(asphalt.buffer(.65))
    if safe.is_empty:return []
    signals=[];centres=[];tree=STRtree(lines)
    for node,branches in sorted(junctions.items(),key=lambda item:(-len(item[1]),item[0])):
        if len(branches)!=4:continue
        origin=Point(node)
        if any(origin.distance(previous)<8 for previous in centres):continue
        if not any(roads[int(i)]['highway'] in ['primary','secondary','trunk'] and lines[int(i)].distance(origin)<.1 for i in tree.query(origin.buffer(.1))):continue
        arms=road_arms(origin,roads,lines,tree)
        approaches=[(*arm['direction'],arm['width']) for arm in arms if arm['incoming']]
        if len(approaches)<2:continue
        width=max(roads[int(i)]['width'] for i in tree.query(origin.buffer(.1)) if lines[int(i)].distance(origin)<.1)
        placed=[]
        for ux,uz,approach_width in approaches:
            if placed:
                ax,az=placed[0]['approach']
                if abs(ax*ux+az*uz)>.7:continue
            corners=[Point(node[0]-ux*(width/2+.65)-uz*side*(approach_width/2+.65),
                           node[1]-uz*(width/2+.65)+ux*side*(approach_width/2+.65)) for side in [1,-1]]
            if placed:
                previous=Point(placed[0]['position'][0],placed[0]['position'][2])
                corners.sort(key=lambda point:point.distance(previous),reverse=True)
            for desired in corners:
                point=nearest_points(desired,safe)[1]
                if placed and point.distance(previous)<5:continue
                if desired.distance(point)>3 or not .6<=point.distance(asphalt)<=2.5:continue
                if any(point.distance(Point(s['position'][0],s['position'][2]))<.8 for s in signals+placed):continue
                placed.append(dict(templateId='traffic_signal',position=[point.x,.16,point.y],
                                 yaw=math.atan2(ux,uz),junction=list(node),approach=[ux,uz],headings=[0],approaches=[[ux,uz]]))
                break
            if len(placed)==2:break
        if len(placed)==2:
            for ux,uz,_ in approaches:
                if any(any(ux*a+uz*b>.995 for a,b in signal['approaches']) for signal in placed):continue
                signal=min(placed,key=lambda signal:(signal['position'][0]-node[0])*ux+(signal['position'][2]-node[1])*uz)
                angle=math.atan2(ux,uz)-signal['yaw']
                angle=math.atan2(math.sin(angle),math.cos(angle))
                angle=round(angle/(math.pi/12))*(math.pi/12)
                if angle not in signal['headings']:signal['headings'].append(angle)
                signal['approaches'].append([ux,uz])
            signals.extend(placed);centres.append(origin)
    return signals

def pedestrian_crossings(signals,roads,sidewalks,asphalt):
    result=[]
    paint_area=asphalt.buffer(-.08)
    lines=[LineString(r['points']) for r in roads];tree=STRtree(lines)
    junctions=sorted({tuple(signal['junction']) for signal in signals})
    for junction in junctions:
      arms=road_arms(Point(junction),roads,lines,tree)
      for arm in arms:
        ux,uz=arm['direction'];nx,nz=-uz,ux;jx,jz=junction;depth=3
        # Adjacent carriageway nodes share the median link, not an extra crossing across it.
        if any(0<(other[0]-jx)*ux+(other[1]-jz)*uz<50 and abs(-(other[0]-jx)*uz+(other[1]-jz)*ux)<2
               and asphalt.covers(LineString([junction,other])) for other in junctions if other!=junction):continue
        perpendicular=[a['width'] for a in arms if abs(sum(x*y for x,y in zip(a['direction'],arm['direction'])))<.7]
        if not perpendicular:continue
        # Leave the corner apex for poles; crosswalks follow the sidewalk routes around it.
        start=max(perpendicular)/2+1+depth/2
        for extra in [0,.5,1,1.5,2]:
            cx,cz=jx+ux*(start+extra),jz+uz*(start+extra)
            section=LineString([(cx-nx*40,cz-nz*40),(cx+nx*40,cz+nz*40)]).intersection(asphalt)
            spans=list(section.geoms) if hasattr(section,'geoms') else [section]
            spans=[line for line in spans if line.geom_type=='LineString' and line.distance(Point(cx,cz))<.01]
            if not spans:continue
            span=min(spans,key=lambda line:line.distance(Point(cx,cz)))
            if not 5<=span.length<=min(32,arm['width']*1.3):continue
            a,b=Point(span.coords[0]),Point(span.coords[-1])
            if any(sidewalks.distance(point)>.5 for point in [a,b]):continue
            centre=span.interpolate(.5,normalized=True);width=span.length
            def rectangle(offset,half_width,half_depth):
                return Polygon([(centre.x+nx*(offset+side*half_width)+ux*end*half_depth,centre.y+nz*(offset+side*half_width)+uz*end*half_depth) for side,end in [(-1,-1),(1,-1),(1,1),(-1,1)]])
            corridor=rectangle(0,width/2,depth/2)
            if corridor.intersection(asphalt).area<corridor.area*.98:continue
            walkway=rectangle(0,width/2+1.2,depth/2)
            if any(walkway.distance(Point(signal['position'][0],signal['position'][2]))<.2 for signal in signals):continue
            count=math.floor((width-.4)/1.2)
            stripes=[tri for i in range(count) for tri in triangles(rectangle((i-(count-1)/2)*1.2,.3,depth/2).intersection(paint_area))]
            stop=[]
            stop_centre=None
            if arm['incoming']:
                # A 1.3 m clear gap exceeds the usual 4 ft between crosswalk and stop bar.
                sx,sz=centre.x+ux*(depth/2+1.5),centre.y+uz*(depth/2+1.5)
                lane_width=width/2 if arm['twoWay'] else width
                lateral=width/4 if arm['twoWay'] else 0
                stop_centre=[sx+nx*lateral,sz+nz*lateral]
                bar=Polygon([(stop_centre[0]+nx*side*(lane_width/2-.1)+ux*end*.2,stop_centre[1]+nz*side*(lane_width/2-.1)+uz*end*.2) for side,end in [(-1,-1),(1,-1),(1,1),(-1,1)]])
                stop=triangles(bar.intersection(paint_area))
            if stripes:
                result.append(dict(centre=[centre.x,centre.y],direction=[ux,uz],width=width,depth=depth,junction=list(junction),stripes=stripes,stopLine=stop,stopCentre=stop_centre))
                break
    return result
