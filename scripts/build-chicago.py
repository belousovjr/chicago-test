"""Offline OSM → metric city. Entry point; geometry lives in chicago_*.py.
Requires Shapely >=2.1. Coordinates: east +X, north +Z, one unit = one metre.
"""
import gzip
import json, math, glob, xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter, defaultdict
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union, polygonize
from shapely.prepared import prep
from chicago_geometry import LON, LAT, BBOX, project, rounded, tags, number, snap_outline, triangles, waterbed_geometry, rings
from chicago_roads import clean_roads, street_surfaces, street_lamps, traffic_signals, pedestrian_crossings
from chicago_railway import elevated_metro, railway_geometry, railway_bridge_trusses, place_railway_supports
from chicago_buildings import building_footprint, fit_building, fit_landmark_group, unsupported_elevated_building

ROOT=Path(__file__).resolve().parents[1]

def main():
    nodes,ways,relations={},{},{}
    files=glob.glob(str(ROOT/'data/chicago/osm-*.xml'))+glob.glob(str(ROOT/'data/chicago/river-*.xml'))
    snapshot=ROOT/'data/chicago/osm-snapshot.xml.gz'
    if snapshot.exists(): files=[snapshot]
    if not files: raise RuntimeError('Run scripts/fetch-chicago.py first')
    for path in files:
        opener=gzip.open if str(path).endswith('.gz') else open
        with opener(path,'rb') as stream: elements=ET.parse(stream).getroot()
        for e in elements:
            if e.tag=='node': nodes[e.attrib['id']]=project(float(e.attrib['lon']),float(e.attrib['lat']))
            elif e.tag=='way': ways[e.attrib['id']]=(tags(e),[n.attrib['ref'] for n in e.findall('nd')])
            elif e.tag=='relation': relations[e.attrib['id']]=(tags(e),[(n.attrib['ref'],n.attrib.get('role','')) for n in e.findall('member') if n.attrib['type']=='way'])
    def coords(refs): return [nodes[n] for n in refs if n in nodes]
    def polygon(refs):
        c=coords(refs)
        if len(c)<4 or c[0]!=c[-1]: return Polygon()
        return Polygon(c).buffer(0)
    bounds=snap_outline(box(*project(BBOX[0],BBOX[1]),*project(BBOX[2],BBOX[3])))
    # Only rivers receive lowered terraces; small pools and fountains are omitted.
    water=[]; relation_buildings=[]; outer_buildings=set()
    for rid,(t,members) in relations.items():
        if (t.get('natural')=='water' and t.get('water')=='river') or t.get('building'):
            lines=[LineString(coords(ways[ref][1])) for ref,role in members if role!='inner' and ref in ways and len(coords(ways[ref][1]))>=2]
            polygons=list(polygonize(unary_union(lines))) if lines else []
            for p in polygons:
                p=p.intersection(bounds)
                if p.is_empty: continue
                if t.get('natural')=='water' and t.get('water')=='river': water.append(p)
                elif t.get('building'):
                    relation_buildings.append((f'r{rid}',t,p));outer_buildings.update(ref for ref,_ in members)
    for wid,(t,refs) in ways.items():
        if t.get('natural')=='water' and t.get('water')=='river':
            p=polygon(refs).intersection(bounds)
            if not p.is_empty:water.append(p)
    water=unary_union(water).buffer(0)
    assert water.area>10000,'Missing river geometry'
    parts=[]; buildings=relation_buildings[:]; roads=[]; parks=[]; rails=[]
    for wid,(t,refs) in ways.items():
        if 'building:part' in t:
            p=polygon(refs)
            if not p.is_empty: parts.append((p,number(t.get('height')) or number(t.get('building:levels'))*3.6))
        if t.get('building') and t['building'] not in ['roof','construction','garage','shed','service'] and wid not in outer_buildings:
            p=polygon(refs).intersection(bounds)
            if p.area>90: buildings.append((f'w{wid}',t,p))
        if t.get('leisure')=='park':
            p=polygon(refs).intersection(bounds)
            if p.area>200: parks.append(p)
        if elevated_metro(t):
            c=coords(refs)
            if len(c)>1:rails.append(LineString(c))
        if t.get('highway') in ['primary','secondary','tertiary','residential','unclassified','trunk','primary_link','secondary_link','tertiary_link','trunk_link'] and t.get('tunnel')!='yes' and number(t.get('layer'))>=0:
            c=coords(refs)
            if len(c)<2:continue
            line=LineString(c).intersection(bounds)
            lines=list(line.geoms) if hasattr(line,'geoms') else [line]
            for line in lines:
                if line.geom_type!='LineString' or line.length<.01:continue
                width=number(t.get('width')) or max(9,min(26,(number(t.get('lanes')) or (3 if t['highway'] in ['primary','secondary'] else 2))*3.2))
                roads.append({'id':f'osm-{wid}','name':t.get('name',''),'highway':t['highway'],'oneway':t.get('oneway','no'),'width':rounded(width),'bridge':t.get('bridge') in ['yes','movable'] or line.intersects(water),'points':[[rounded(x),rounded(z)] for x,z in line.simplify(1).coords]})
    railway=railway_geometry(rails,bounds,water)
    roads=clean_roads(roads,bounds)
    road_union,sidewalks,pavement=street_surfaces(roads,bounds)
    road_cover=prep(road_union.buffer(.05))
    roads=[r for r in roads if road_cover.covers(LineString(r['points']))]
    pavement=pavement.union(road_union)
    sidewalks=pavement.difference(road_union)
    water=snap_outline(water.simplify(0.5,preserve_topology=True))
    river_buffer=snap_outline(water.buffer(7,join_style=3))
    exposed_ground=bounds.difference(river_buffer).difference(pavement)
    rail_deck=unary_union([Polygon(t) for t in railway['deck']])
    railway['bridgeTrusses']=railway_bridge_trusses(rail_deck,pavement,water,bounds.difference(river_buffer))
    railway['supports']=place_railway_supports(railway['supports'],sidewalks,road_union,river_buffer,rail_deck,exposed_ground)
    rail_clearance=rail_deck.buffer(1.5)
    rail_clearance=rail_clearance.union(unary_union([LineString([(s['position'][0],s['position'][2]),s['attachment']]).buffer(.5) for s in railway['supports']]))
    building_land=exposed_ground.difference(rail_clearance)
    fitted_count=skipped_count=0
    specs=[
      ('glass','Стеклянная офисная башня',[32,100,32],'#759ca8',[180,650]),
      ('stone','Чикагская школа · каменный корпус',[36,55,30],'#b8ac91',[130,500]),
      ('deco','Ар-деко · ступенчатая башня',[36,140,32],'#b9b29f',[180,700]),
      ('bundled','Willis · пучок труб',[70,442,70],'#424d56',[250,1000]),
      ('rounded','Trump · округлая башня',[58,423,60],'#9cb6bd',[220,900]),
      ('marina','Marina City · круглая башня',[38,179,38],'#c6c0a9',[180,650]),
      ('gothic','Tribune · готическая корона',[45,141,40],'#baa992',[180,650]),
      ('clock','Wrigley · светлая часовая башня',[50,134,40],'#ded9bf',[180,650]),
      ('tree','Уличное дерево',[5,8,5],'#648263',[90]),
      ('traffic_signal','Уличный светофор',[.7,4.5,.7],'#e0ded3',[100]),
      ('lamp','Чикагский фонарь',[1,8,1],'#414c4c',[100]),
    ]
    templates=[dict(id=p,name=n,kind='building' if p not in ['tree','lamp','traffic_signal'] else 'obstacle',size=s,color=c,profile=p,lodDistances=d) for p,n,s,c,d in specs]
    objects=[]; source=[]; heights=Counter(); families=Counter(); seen_ids=Counter()
    records=[]
    for wid,t,p in buildings:
        if unsupported_elevated_building(t):continue
        if p.geom_type=='MultiPolygon':p=max(p.geoms,key=lambda v:v.area)
        if p.area<90:continue
        center=p.centroid
        if not bounds.contains(center) or water.contains(center):continue
        rect=p.minimum_rotated_rectangle
        c=list(rect.exterior.coords);v=(c[1][0]-c[0][0],c[1][1]-c[0][1]);w=math.hypot(*v);d=math.dist(c[1],c[2]);yaw=-math.atan2(v[1],v[0]);yaw=(yaw+math.pi)%(2*math.pi)-math.pi
        if min(w,d)<5 or max(w,d)>500:continue
        name=t.get('name','');low=name.lower()
        tagged=number(t.get('height'))
        if 'ft' in t.get('height','') or "'" in t.get('height',''):tagged*=0.3048
        partheight=max([h for poly,h in parts if h and p.intersection(poly).area>min(p.area,poly.area)*0.6]+[0])
        h=max(tagged,partheight)
        method='osm-height' if h else 'osm-levels' if number(t.get('building:levels')) else 'estimated'
        h=h or number(t.get('building:levels'))*3.6 or (24 if p.area<600 else 55)
        year=number(t.get('start_date'))
        profile='deco' if 1900<year<1945 and h>75 else 'stone' if (year and year<1950) or h<65 else 'glass'
        for match,family,height in [('willis tower','bundled',442),('trump international','rounded',423),('tribune tower','gothic',141),('wrigley building','clock',134),('marina city 1','marina',179),('marina city 2','marina',179)]:
            if match in low:profile=family;h=height;method='landmark-reference'
        if profile=='clock' and 70<partheight<130: h=partheight
        h=max(6,min(600,h))
        seen_ids[wid]+=1
        unique_id=wid if seen_ids[wid]==1 else f'{wid}-{seen_ids[wid]}'
        # Snap the footprint anchor; the vertical centre follows half-height to keep the base at zero.
        w,d,h=[round(value*4)/4 for value in [w,d,h]]
        yaw=round(yaw/(math.pi/12))*(math.pi/12)
        o=dict(id=f'osm-{unique_id}',templateId=profile,name=name or t.get('addr:street','Chicago building'),position=[round(rect.centroid.x),h/2,round(rect.centroid.y)],size=[w,h,d],yaw=yaw)
        records.append(dict(object=o,protected=method=='landmark-reference' or profile=='deco' or h>=150,method=method,
                            source=dict(id=wid,name=name,height=rounded(h),heightSource=method,profile=profile,footprint=[[rounded(x),rounded(z)] for x,z in p.exterior.coords])))
    groups=defaultdict(list)
    for record in records:
        o=record['object']
        if record['protected']:
            # Repeated Marina profiles form an identical ensemble; other landmarks retain their own proportions.
            key=('identical',o['templateId']) if o['templateId']=='marina' else ('single',o['id'])
            groups[key].append(record)
    protected_ids=[]
    for key,group in sorted(groups.items(),key=lambda pair:(pair[0][0]!='identical',pair[0])):
        fitted=fit_landmark_group([r['object'] for r in group],building_land,key[0]=='identical')
        for record,o in zip(group,fitted):
            record['fitted']=o
            protected_ids.append(o['id'])
        building_land=building_land.difference(unary_union([building_footprint(o).buffer(0.5) for o in fitted]))
    for record in records:
        original=record['object']
        o=record.get('fitted') if record['protected'] else fit_building(original,building_land)
        if o is None:
            skipped_count+=1
            continue
        if o!=original:fitted_count+=1
        assert exposed_ground.covers(building_footprint(o)), f"Unsupported building: {o['id']}"
        families[o['templateId']]+=1;heights[record['method']]+=1
        objects.append(o);source.append(record['source'])
    # Carry the structural slab across the lowered bank terrace and into solid ground.
    bridge=pavement.intersection(river_buffer.buffer(2,join_style=3))
    abutments=pavement.intersection(water.buffer(2,join_style=3).difference(water))
    bridge_rails=bridge.boundary.intersection(river_buffer.buffer(-0.5))
    rail_lines=list(bridge_rails.geoms) if hasattr(bridge_rails,'geoms') else [bridge_rails]

    # No almost-coplanar ground beneath paving: it flickers through at overview distances.
    assert exposed_ground.intersection(pavement).area<1e-6
    # Triangulate first, then batch: cutting polygons at cell borders introduces extra seam vertices.
    grass_surface=unary_union(parks).intersection(exposed_ground)
    terrain_cells=defaultdict(list)
    for tri in triangles(exposed_ground.difference(grass_surface)):
        cell=tuple(math.floor(sum(p[i] for p in tri)/3/256)*256 for i in [0,1])
        terrain_cells[cell].append(tri)
    terrain=[dict(cell=list(cell),triangles=tris) for cell,tris in sorted(terrain_cells.items())]
    # Riverwalk is an explicitly stylized lower terrace, not a surveyed elevation model.
    riverwalk=river_buffer.difference(water).intersection(bounds)
    # A usable spawn on State Street, south of the river, outside building bounds.
    spawn=project(-87.6278,41.8865)
    world=dict(version=3,environment='chicago-loop',spawn=[round(spawn[0]),1,round(spawn[1])],templates=templates,objects=objects)
    curbs=snap_outline(road_union.buffer(0.22,join_style=3)).difference(road_union).intersection(sidewalks)
    sidewalks=sidewalks.difference(curbs)
    paving_edges=[dict(top=height,color=color,lines=rings(poly)) for poly,height,color in [(road_union,0.03,'#454e50'),(sidewalks,0.16,'#b6b2a4'),(curbs,0.18,'#c0bba9')]]
    assert bounds.difference(unary_union([exposed_ground,road_union,sidewalks,curbs,water,riverwalk])).area<1e-6, 'Uncovered terrain seam'
    terrace_lines=rings(river_buffer.intersection(bounds))
    signals=traffic_signals(roads,sidewalks,road_union)
    lamps=[lamp for lamp in street_lamps(roads,sidewalks,road_union) if all(math.dist(lamp['position'],signal['position'])>1.5 for signal in signals)]
    env=dict(crosswalks=pedestrian_crossings(signals,roads,sidewalks,road_union),trafficSignals=signals,lamps=lamps,railway=railway,roadSurface=triangles(road_union),sidewalks=triangles(sidewalks),curbs=triangles(curbs),pavingEdges=paving_edges,terraceWalls=terrace_lines,origin=[LON,LAT],bounds=list(map(rounded,bounds.bounds)),roads=roads,terrain=terrain,water=triangles(water),riverwalk=triangles(riverwalk),parks=triangles(grass_surface),shorelines=rings(water),bridgeDeck=triangles(bridge),bridgeEdges=rings(bridge),bridgeAbutments=rings(abutments),bridgeRails=[[[float(x),float(z)] for x,z in line.coords] for line in rail_lines if line.geom_type=='LineString' and line.length>1])
    env['waterbed']=waterbed_geometry(water)
    output=dict(world=world,environment=env,report=dict(buildings=len(objects),protectedBuildings=protected_ids,fittedBuildings=fitted_count,omittedBuildings=skipped_count,roads=len(roads),families=dict(families),heights=dict(heights),bounds=BBOX,origin=[LON,LAT],licence='ODbL-1.0',attribution='© OpenStreetMap contributors',waterArea=rounded(water.area)))
    assert len({o['id'] for o in objects})==len(objects), 'Duplicate OSM building IDs'
    (ROOT/'src/generated').mkdir(exist_ok=True)
    (ROOT/'src/generated/chicago.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
    (ROOT/'data/chicago/buildings.json').write_text(json.dumps(source,separators=(',',':'))+'\n')
    (ROOT/'data/chicago/report.json').write_text(json.dumps(output['report'],indent=2)+'\n')
    minx,minz,maxx,maxz=env['bounds']; svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx} {-maxz} {maxx-minx} {maxz-minz}"><rect x="{minx}" y="{-maxz}" width="{maxx-minx}" height="{maxz-minz}" fill="#e5e1d5"/>']
    for tri in env['water']:svg.append('<polygon fill="#80afbb" points="'+' '.join(f'{x},{-z}' for x,z in tri)+'"/>')
    for r in roads:svg.append('<polyline fill="none" stroke="#fff" stroke-width="'+str(r['width'])+'" points="'+' '.join(f'{x},{-z}' for x,z in r['points'])+'"/>')
    for b in source:svg.append('<polygon fill="#8b9492" stroke="#45585c" stroke-width="1" points="'+' '.join(f'{x},{-z}' for x,z in b['footprint'])+'"><title>'+b['name'].replace('&','&amp;').replace('<','&lt;')+'</title></polygon>')
    for b in source:
        if b['profile'] in ['bundled','rounded','marina','gothic','clock']:
            cx=sum(p[0] for p in b['footprint'])/len(b['footprint']);cz=sum(p[1] for p in b['footprint'])/len(b['footprint'])
            svg.append(f'<text x="{cx}" y="{-cz}" font-size="11" fill="#182d32" stroke="#fff" stroke-width="2" paint-order="stroke">'+b['name'].replace('&','&amp;').replace('<','&lt;')+'</text>')
    svg.append(f'<path d="M {minx+25} {-minz-50} h 200 m -200 -5 v 10 m 200 -10 v 10" fill="none" stroke="#213b40" stroke-width="2"/>')
    svg.append(f'<circle cx="{spawn[0]}" cy="{-spawn[1]}" r="8" fill="#cf5936"/><text x="{minx+25}" y="{-maxz+35}" font-size="20">CHICAGO LOOP · 1 unit = 1 m · N ↑</text><text x="{minx+25}" y="{-minz-20}" font-size="14">© OpenStreetMap contributors · ODbL · 200 m</text></svg>')
    (ROOT/'public/maps/chicago.svg').write_text(''.join(svg))
    assert len(objects)>100 and len(roads)>100 and any(o['templateId']=='bundled' for o in objects)
    print(json.dumps(output['report'],indent=2))
if __name__=='__main__':main()
