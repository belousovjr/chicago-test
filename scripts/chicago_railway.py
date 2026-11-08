"""Continuous elevated tracks, supports and bridge trusses."""
import math
from shapely.geometry import LineString, Point
from shapely.ops import unary_union, linemerge, nearest_points
from shapely.prepared import prep
from chicago_geometry import number, rings, triangles

def elevated_metro(t):
    return (t.get('railway')=='subway' and t.get('operator')=='Chicago Transit Authority'
            and number(t.get('layer'))>0 and t.get('tunnel')!='yes' and not t.get('service'))

def railway_geometry(lines,bounds,water):
    tracks=unary_union(lines)
    if tracks.is_empty:return dict(deck=[],edges=[],rails=[],railEdges=[],supports=[])
    # Merge before clipping; short way fragments and shared endpoints are part of the same route.
    tracks=linemerge(tracks) if tracks.geom_type=='MultiLineString' else tracks
    paths=list(tracks.geoms) if hasattr(tracks,'geoms') else [tracks]
    deck=unary_union([line.buffer(2.1,cap_style=2,join_style=2,mitre_limit=2) for line in paths]).intersection(bounds)
    rails=unary_union([line.offset_curve(side,join_style=2,mitre_limit=2).buffer(.045,cap_style=2,join_style=2) for line in paths for side in [-.72,.72]]).intersection(bounds)
    supports=[]
    unsupported_water=water.buffer(1)
    for ring in rings(deck):
        edge=LineString(ring)
        for distance in range(4,int(edge.length),4):
            point=edge.interpolate(distance)
            if not unsupported_water.covers(point): supports.append([point.x,point.y])
    return dict(deck=triangles(deck),edges=rings(deck),rails=triangles(rails),railEdges=rings(rails),supports=supports)

def railway_bridge_trusses(deck,pavement,water,banks):
    crossings=deck.buffer(2,join_style=2).intersection(water)
    polygons=list(crossings.geoms) if hasattr(crossings,'geoms') else [crossings]
    result=[]
    for polygon in polygons:
        if polygon.area<100:continue
        rectangle=polygon.minimum_rotated_rectangle
        corners=list(rectangle.exterior.coords)
        a,b=max(zip(corners,corners[1:]),key=lambda edge:math.dist(*edge))
        length=math.dist(a,b);ux,uz=(b[0]-a[0])/length,(b[1]-a[1])/length
        nx,nz=-uz,ux;mid=rectangle.centroid
        section=LineString([(mid.x-nx*30,mid.y-nz*30),(mid.x+nx*30,mid.y+nz*30)]).intersection(pavement)
        spans=list(section.geoms) if hasattr(section,'geoms') else [section]
        spans=[line for line in spans if line.geom_type=='LineString' and line.distance(mid)<.01]
        if spans:
            span=max(spans,key=lambda line:line.length);centre=span.centroid;width=span.length-1
        else:
            centre=mid;width=min(math.dist(a,b) for a,b in zip(corners,corners[1:]))-3.6
        if width<4:continue
        distances=[-length/2-2,length/2+2]
        bank_supported=not spans
        if bank_supported:
            safe_banks=prep(banks.buffer(-.3))
            # Both chords must reach the upper bank, beyond the lowered riverwalk.
            for end,direction in enumerate([-1,1]):
                for step in range(513):
                    distance=distances[end]+direction*step*.5
                    if all(safe_banks.covers(Point(centre.x+nx*sign*width/2+ux*distance,centre.y+nz*sign*width/2+uz*distance)) for sign in [-1,1]):
                        distances[end]=distance
                        break
                else:raise ValueError('Railway truss cannot reach solid banks within 256 m')
        sides=[[[centre.x+nx*sign*width/2+ux*distance,centre.y+nz*sign*width/2+uz*distance] for distance in distances] for sign in [-1,1]]
        result.append(dict(sides=sides,bankSupported=bank_supported,panels=max(2,min(8,math.ceil((distances[1]-distances[0])/12)))))
    return result

def railway_support_candidates(points,sidewalks,asphalt,lowered_banks,deck,ground):
    allowed=sidewalks.buffer(-.5).union(ground.buffer(-.5)).difference(lowered_banks.buffer(.5))
    if allowed.is_empty:return []
    allowed=allowed.difference(deck.buffer(.55))
    edges=[LineString(ring) for ring in rings(deck)]
    for x,z in points:
        origin=Point(x,z)
        edge=min(edges,key=lambda line:line.distance(origin));distance=edge.project(origin)
        a=edge.interpolate((distance-.5)%edge.length);b=edge.interpolate((distance+.5)%edge.length)
        dx,dz=b.x-a.x,b.y-a.y;length=math.hypot(dx,dz)
        if length<.01:continue
        normal=math.atan2(dx,-dz)
        for angle in [0,5,-5,10,-10]:
            nx,nz=math.cos(normal+math.radians(angle)),math.sin(normal+math.radians(angle))
            cross=LineString([(x-nx*40,z-nz*40),(x+nx*40,z+nz*40)]).intersection(deck)
            spans=list(cross.geoms) if hasattr(cross,'geoms') else [cross]
            spans=[line for line in spans if line.geom_type=='LineString' and line.length>2]
            if not spans:continue
            span=min(spans,key=lambda line:line.distance(origin))
            # Join nearby parallel tracks into one frame, without filling the deck gap.
            for neighbour in sorted(spans,key=lambda line:line.distance(span)):
                if neighbour==span or span.distance(neighbour)>4:continue
                mid=neighbour.interpolate(.5,normalized=True)
                if not all(deck.covers(Point(mid.x-nz*offset,mid.y+nx*offset)) for offset in [-6,6]):continue
                endpoints=[Point(p) for line in [span,neighbour] for p in [line.coords[0],line.coords[-1]]]
                endpoints.sort(key=lambda p:p.x*nx+p.y*nz)
                joined=LineString([endpoints[0],endpoints[-1]])
                if joined.length<=14:span=joined
            a,b=Point(span.coords[0]),Point(span.coords[-1])
            ux,uz=(b.x-a.x)/span.length,(b.y-a.y)/span.length
            pair=[]
            for point,sign in [(a,-1),(b,1)]:
                candidates=allowed.intersection(LineString([(point.x+ux*.55*sign,point.y+uz*.55*sign),(point.x+ux*4*sign,point.y+uz*4*sign)]))
                if candidates.is_empty:break
                foot=nearest_points(point,candidates)[1]
                pair.append(dict(position=[foot.x,.16 if sidewalks.covers(foot) else 0,foot.y],top=6.05,attachment=[point.x,point.y],skew=angle))
            if len(pair)!=2:continue
            pa,pb=pair[0]['position'],pair[1]['position']
            spacing=math.hypot(pa[0]-pb[0],pa[2]-pb[2])
            if spacing<max(2,span.length*.6) or max(span.length,spacing)>14:continue
            yield pair
            break

def place_railway_supports(points,sidewalks,asphalt,lowered_banks,deck,ground):
    supports=[];centres=[]
    for pair in railway_support_candidates(points,sidewalks,asphalt,lowered_banks,deck,ground):
        a,b=pair[0]['position'],pair[1]['position']
        centre=Point((a[0]+b[0])/2,(a[2]+b[2])/2)
        if any(centre.distance(previous)<20 for previous in centres):continue
        centres.append(centre);supports.extend(pair)
    return supports
