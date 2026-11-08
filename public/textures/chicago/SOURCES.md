# Chicago Loop texture palette

Runtime textures are local WebP files. No CDN or runtime texture generation.
Sources and ZIP SHA-256 hashes are in `manifest.json`. All source assets are
CC0 1.0 Universal: https://docs.ambientcg.com/license/ . The derived facade, roofing, painted steel, lightmap,
paint, water and environment images are also dedicated to CC0 1.0.

## Chicago references (visual reference only; photographs are not redistributed)

- Willis Tower: black aluminum and bronze-tinted glass.
  https://www.architecture.org/online-resources/buildings-of-chicago/willis-tower
- Marina City: reinforced concrete, repeated circular balconies.
  https://www.architecture.org/online-resources/buildings-of-chicago/marina-city
  https://www.wttw.com/ten/homes/marina-city
- Rookery: brick masonry, terra cotta, stone and cast iron.
  https://www.therookerybuilding.com/specifications
- Historic Chicago terra cotta cladding (Reliance Building):
  https://webapps1.chicago.gov/landmarksweb/web/landmarkdetails.htm?lanId=1359

- Historic Loop elevated structure, warm brown painted steel at night:
  https://chaddavis.photography/chicago-l-structure-and-cta-sign-in-the-loop/
- Chicago night skyline and restrained warm/cool office lighting:
  https://www.marriott.com/en-us/hotels/chiwi-the-westin-michigan-avenue-chicago/photos/
  https://www.classicistchicago.org/regional-intensives

These establish a small stylized palette, not photogrammetric replicas of
individual buildings. Low-rise stone-profile blocks use buff brick; taller
masonry blocks use a light stone/terra-cotta facade. Colors are baked into the textures: neutral grey-green glass, dark bronze/black
Willis facade, buff masonry, matte concrete bases, charcoal roofing and warm brown
painted elevated steel. Only rail heads use the neutral metal material. Default
legacy object colors no longer tint textured surfaces; explicit color overrides
still work. Concrete and roofs never inherit glazing reflections or window masks.

## Source textures

Lennart Demes / ambientCG, CC0:

- Asphalt031: https://ambientcg.com/view?id=Asphalt031
- Concrete031: https://ambientcg.com/view?id=Concrete031
- Bricks090: https://ambientcg.com/view?id=Bricks090
- Metal046A: https://ambientcg.com/view?id=Metal046A
- Grass004: https://ambientcg.com/view?id=Grass004

Original 1K ZIPs are cached outside the repository. Rebuild with:

```
python3 -m pip install -r scripts/requirements.txt
npm run textures:build -- --cache /tmp/chicago-texture-sources
```

The script downloads missing sources, bakes the material palette, creates
facades and generates all lower-resolution variants. `palette.webp` previews
the set. It does not run during game startup.

## Maps and rendering cost

- Terrain/material albedo: 512² / 128² / 32² for LOD 0 / 1 / 2.
- Whole-facade albedo and emission: 1024² / 512² / 128²; distant patterns are
  low-pass filtered before downsampling rather than repeated in tiny tiles.
- LOD 0 adds AO, OpenGL normal and 256² specular/glossiness; LOD 1/2 use
  baked AO and omit normal/AO/specular texture samples.
- Mipmaps, 8× anisotropy for facades and 4× for other materials.
- Terrain has no duplicate LOD geometry: automatic mip selection reduces its
  texture sampling resolution with distance. Existing detail meshes use their
  own near/far materials. No extra geometry is added for texture LOD.
- Reflective surfaces use one shared 128² cubemap, generated offline. Glass,
  metal and water use different specular power, reflection roughness and
  Fresnel response; other surfaces have only a faint, broad highlight.
- Original cavity/AO is preserved; Metal046A has generated cavity AO from
  source height. Facades have generated recess AO and normals. These are
  contact/recess shading maps, not directional dynamic shadow maps.
- No parallax, displacement, real-time reflection probe or alpha-blended glass.
- Hero, trees, lamp light heads and traffic-signal lenses remain untextured.

`src/facadeLayout.json` defines the window grid for both the texture baker and
architectural geometry. Facade UVs span the exposed wall between base and roof;
structural belts and ribs follow window-cell boundaries and fit inside their
opaque gaps, with filtering margin. Geometry and night masks use the same layout.

Roof caps and concrete bases persist at every LOD and are batched by material
(three submeshes for the standard glass building). A quiet patch also keeps windows off the
underlying horizontal facade faces. UVs on procedural
surfaces are projected in world units, including walls and bridge undersides.

## Day/night emission

Facade masks use three deterministic layouts of contiguous rooms, approximately
10–15% lit windows, desaturated warm white and occasional cool white. Masks share
the albedo layout at every LOD and do not tile across a facade. Roofs remain dark.
Eight percent of all windows are selected from the lit rooms and emit four times
as much light. The maps reserve 4× headroom so ordinary windows keep their previous
brightness without clipping the brighter ones.
These are self-illumination masks, not individual window lights.

A shared 1024² world-space lightmap provides a denser, warm building-edge spill and warm
street-lamp pools at every distance. It is baked from the generated city snapshot:
rerun texture generation after rebuilding the city. It does not follow manual
editor changes. UV2 coordinates stay aligned across procedural mesh cells.
Four live nearby spotlights affect moving actors; ground lighting does not pop
when those lights are reassigned. Lamp heads remain emissive in the far LOD and
have a longer nighttime visibility range.

The reflection cubemap is dimmed at night, not recaptured. Sky, sunlight and
nearby actor lighting are handled by `src/dayNight.ts`.

## Riverbed

The matte brown-grey riverbed reuses the fine-grained source detail of Grass004,
recolored to sediment rather than vegetation, with the same LOD/map setup as
other terrain. No reflective material or street-light lightmap is applied below
water. The concave channel is sloped from an uneven sediment edge 1–3 m below water, rounding into an 18 m
deep centre, with small sediment ripples. Depth is stylized, not
surveyed bathymetry.

The underwater palette is a small per-fragment world-height tint in the city and
character materials. It follows the flat water level across partially submerged
objects, with a 6 cm transition; the HUD, sky and above-water fragments are
untouched. Underwater ray segments accumulate blue-green haze at five times
the ground fog rate, with a darker night palette. No camera-wide filter, depth texture or extra render pass is used.

## Animated water interface

Only the water surface uses the WaterSurface material plugin. Two travelling
normal waves drive the existing lighting and static environment reflection;
wave detail fades between 40 and 180 m and is skipped beyond 180 m. Water skips
AO, normal and specular texture reads, keeping its color texture and shared
cube map. No scene capture, refraction buffer, extra pass or geometry displacement
is used. Surface opacity remains camera-dependent (opaque above, 95% below).

## Distant surface detail

Repeated microdetail on roofs, concrete, asphalt, metal, grass, riverbed and paint
fades between 16 and 96 m into the measured mean of each LOD texture. AO and normal
detail fade with albedo; lighting, shadows, vertex tint and street lightmaps remain.
Windows, brick patterns, water and emissive lenses are excluded. The shared
SurfaceDetail plugin adds no texture samples or render passes; surfaceAverages.json
is regenerated by build-textures.py from the bundled maps.

Technique references:
- https://dev.epicgames.com/documentation/unreal-engine/adding-detail-textures-to-unreal-engine-materials
- https://www.wolfire.com/blog/2009/12/Fading-detail-textures/
