"""Building footprints and non-destructive fitting of landmark groups."""
import math
from shapely.geometry import box
from shapely.ops import unary_union
from shapely.affinity import rotate, translate
from shapely.prepared import prep
from chicago_geometry import number

def building_footprint(o):
    w,_,d=o['size'];x,_,z=o['position']
    # Include the largest architectural trim (1.03 times the collision footprint).
    return translate(rotate(box(-w*.515,-d*.515,w*.515,d*.515),-o['yaw'],origin=(0,0),use_radians=True),x,z)

def fit_building(o,land):
    original=building_footprint(o)
    if land.covers(original):return o
    space=land.intersection(original)
    polygons=list(space.geoms) if hasattr(space,'geoms') else [space]
    polygons=[p for p in polygons if p.geom_type=='Polygon' and p.area>=25]
    if not polygons:return None
    parcel=max(polygons,key=lambda p:p.area)
    points=[parcel.centroid,parcel.representative_point()]
    centres=[(o['position'][0],o['position'][2]),*[(round(p.x),round(p.y)) for p in points]]
    w,h,d=o['size']
    sizes={(math.floor(w*a/20*4)/4,math.floor(d*b/20*4)/4) for a in range(7,21) for b in range(7,21)}
    for width,depth in sorted(sizes,key=lambda size:(size[0]*size[1],size),reverse=True):
        if min(width,depth)<5 or width*depth<w*d*.25:continue
        for x,z in centres:
            fitted=dict(o,position=[x,h/2,z],size=[width,h,depth])
            if space.covers(building_footprint(fitted)):return fitted
    return None

def fit_landmark_group(objects,land,identical=False):
    # Preserve composition: one translation and one horizontal scale for the whole group.
    allowed=prep(land)
    offsets=sorted(((x,z) for x in range(-32,33) for z in range(-32,33)),key=lambda p:(p[0]**2+p[1]**2,p))
    if identical:
        diameter=math.floor(min(min(o['size'][0],o['size'][2]) for o in objects)*4)/4
        objects=[dict(o,size=[diameter,max(v['size'][1] for v in objects),diameter],yaw=0) for o in objects]
    for step in range(20,9,-1):
        candidates=[dict(o,size=[math.floor(o['size'][0]*step/20*4)/4,o['size'][1],math.floor(o['size'][2]*step/20*4)/4]) for o in objects]
        footprint=unary_union([building_footprint(o) for o in candidates])
        for dx,dz in offsets:
            if allowed.covers(translate(footprint,dx,dz)):
                return [dict(o,position=[o['position'][0]+dx,o['size'][1]/2,o['position'][2]+dz]) for o in candidates]
    raise RuntimeError('Cannot preserve landmark group within 32 m: '+', '.join(o['id'] for o in objects))

def unsupported_elevated_building(t):
    # Layer is ordering, not metres: do not invent ground-level towers for untyped elevated structures.
    return (number(t.get('layer'))>0 and t.get('building')=='yes'
            and not t.get('name') and not number(t.get('height')) and not number(t.get('building:levels')))
