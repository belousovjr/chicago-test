from pathlib import Path
import xml.etree.ElementTree as E,gzip
root=Path(__file__).resolve().parents[1]/'data/chicago';entries={}
for p in [*root.glob('osm-*.xml'),*root.glob('river-*.xml')]:
 for e in E.parse(p).getroot():
  if e.tag in ['node','way','relation']:entries[(e.tag,e.attrib['id'])]=e
ways={i:e for (kind,i),e in entries.items() if kind=='way'}
rels=[];needed=set()
for (kind,i),e in entries.items():
 if kind!='relation':continue
 t={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
 if t.get('natural')=='water' or t.get('building'):
  rels.append(e);needed.update(m.attrib['ref'] for m in e.findall('member') if m.attrib['type']=='way')
for i,e in ways.items():
 t={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
 if any(k in t for k in ['building','building:part','highway','railway']) or t.get('natural')=='water' or t.get('leisure')=='park':needed.add(i)
nodeids={n.attrib['ref'] for i in needed if i in ways for n in ways[i].findall('nd')}
out=E.Element('osm',version='0.6',attribution='© OpenStreetMap contributors',licence='ODbL-1.0')
for i in sorted(nodeids):
 e=entries.get(('node',i))
 if e is not None:E.SubElement(out,'node',id=i,lon=e.attrib['lon'],lat=e.attrib['lat'])
keep={'operator','network','service','usage','railway','name','height','building','building:part','building:levels','building:material','building:colour','start_date','highway','oneway','width','lanes','layer','bridge','tunnel','natural','water','leisure','type','addr:street'}
for e in [*(ways[i] for i in sorted(needed) if i in ways),*rels]:
 n=E.SubElement(out,e.tag,id=e.attrib['id'])
 for child in e:
  if child.tag in ['nd','member'] or child.tag=='tag' and child.attrib['k'] in keep:E.SubElement(n,child.tag,child.attrib)
with gzip.GzipFile(root/'osm-snapshot.xml.gz','wb',mtime=0) as f:f.write(E.tostring(out,encoding='utf-8'))
print('Packed',len(nodeids),'nodes',len(needed),'ways',(root/'osm-snapshot.xml.gz').stat().st_size,'bytes')
