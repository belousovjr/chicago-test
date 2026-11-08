// Test the trunk footprint, not just its centre, against the actual asphalt triangles.
export function treeOverlapsRoad(x: number, z: number, triangles: number[][][], radius = .25) {
  return triangles.some(triangle => {
    const xs=triangle.map(p=>p[0]!), zs=triangle.map(p=>p[1]!);
    if(x+radius<Math.min(...xs)||x-radius>Math.max(...xs)||z+radius<Math.min(...zs)||z-radius>Math.max(...zs))return false;
    const sides=triangle.map((a,i)=>{
      const b=triangle[(i+1)%3]!;
      return (b[0]!-a[0]!)*(z-a[1]!)-(b[1]!-a[1]!)*(x-a[0]!);
    });
    if(sides.every(v=>v>=0)||sides.every(v=>v<=0))return true;
    return triangle.some((a,i)=>{
      const b=triangle[(i+1)%3]!, dx=b[0]!-a[0]!, dz=b[1]!-a[1]!;
      const t=Math.max(0,Math.min(1,((x-a[0]!)*dx+(z-a[1]!)*dz)/Math.max(1e-12,dx*dx+dz*dz)));
      return Math.hypot(x-a[0]!-t*dx,z-a[1]!-t*dz)<=radius;
    });
  });
}
