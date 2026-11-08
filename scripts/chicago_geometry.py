"""Metric projection, shared polygon operations and riverbed triangulation."""
import math, re
from shapely.geometry import Polygon, box
from shapely import constrained_delaunay_triangles, set_precision
from shapely.geometry.polygon import orient

LON,LAT=-87.63075,41.88425
BBOX=(-87.642,41.877,-87.6195,41.8915)

def project(lon,lat): return ((lon-LON)*111320*math.cos(math.radians(LAT)),(lat-LAT)*111320)

def rounded(v): return round(float(v),2)

def tags(e): return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}

def number(s):
    m=re.search(r'[-+]?\d+(?:\.\d+)?',str(s or ''))
    return float(m.group()) if m else 0

def snap_outline(poly):
    # Snap source outlines once; keep intersections exact so neighbouring surfaces share vertices.
    return set_precision(set_precision(poly,0.01),0)

def triangles(poly):
    # Constrained triangulation preserves concave boundaries and holes without dropping faces.
    faces=constrained_delaunay_triangles(poly)
    assert abs(sum(t.area for t in faces.geoms)-poly.area)<max(1e-6,poly.area*1e-9), 'Incomplete surface triangulation'
    return [[[float(x),float(z)] for x,z in list(t.exterior.coords)[:3]] for t in faces.geoms]

def waterbed_geometry(water):
    # Resolve the wavy sediment edge without refining the entire channel.
    water=water.segmentize(2)
    step=8
    xmin,zmin,xmax,zmax=water.bounds
    result=[]
    for x in range(math.floor(xmin/step)*step,math.ceil(xmax/step)*step,step):
        for z in range(math.floor(zmin/step)*step,math.ceil(zmax/step)*step,step):
            patch=water.intersection(box(x,z,x+step,z+step))
            if patch.area>1e-8:result.extend(triangles(patch))
    area=sum(Polygon(t).area for t in result)
    assert abs(area-water.area)<1e-5, 'Incomplete riverbed'
    return result

def rings(poly):
    polygons=list(poly.geoms) if hasattr(poly,'geoms') else [poly]
    return [[[float(x),float(z)] for x,z in ring.coords]
            for p in polygons if p.geom_type=='Polygon' for q in [orient(p,sign=1)] for ring in [q.exterior,*q.interiors]]
