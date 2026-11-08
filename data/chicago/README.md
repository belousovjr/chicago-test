# Chicago Loop source data

Snapshot date: 2026-11-07. Bounding box: west -87.642, south 41.877,
east -87.6195, north 41.8915. Approximate extent: 1.86 km east–west × 1.61 km north–south.
Origin: longitude -87.63075, latitude 41.88425. Projection is a local equirectangular
approximation; one game unit is one metre, X east, Z north. This is a bounded district,
not all downtown Chicago.

## Source and licence

© OpenStreetMap contributors, Open Database Licence (ODbL) 1.0.
Original data: https://www.openstreetmap.org/#map=15/41.88425/-87.63075
Attribution and licence: https://www.openstreetmap.org/copyright
Licence text: https://opendatacommons.org/licenses/odbl/1-0/

The compressed source snapshot, extracted footprints, SVG map and generated map database
are OSM-derived data distributed under ODbL. Application code and procedural architecture
are separate from this data. Visible attribution is included in the game and SVG map.

- `osm-snapshot.xml.gz`: deduplicated source geometry/tags; contributor metadata and unrelated POIs removed.
- `buildings.json`: original clipped footprints, architectural classification, height and height provenance.
- `report.json`: counts and provenance summary.
- `../../src/generated/chicago.json`: generated runtime scene and procedural street data.
- `../../public/maps/chicago.svg`: north-up schematic map, named landmarks, metric scale and spawn marker.
- `osm-*.xml` and `river-*.xml`: ignored HTTP download cache.

## Pipeline

From the repository root, with Python 3.10+ and Shapely 2.1+ installed:

```sh
python3 -m pip install -r scripts/requirements.txt
npm run city:build
```

This rebuilds entirely offline from the tracked snapshot. The application itself needs
neither Python nor Shapely. To fetch raw source again, clear the ignored XML cache, then run:

```sh
npm run city:fetch
npm run city:build
```

The fetcher uses nine small official OSM API map requests, at most two at once,
and three full river relations. It reuses existing cache files. The packer deduplicates
and strips source metadata. The builder clips geometry, projects to metres, fits oriented
building rectangles, classifies templates and generates terrain/road polygons. Triangulation
and road/sidewalk unions run offline, never in the browser. Assertions and application tests
check IDs, dimensions, heights, triangle orientation, spawn support and LOD reduction.

## Accuracy and deliberate simplification

- Building positions and footprint dimensions come from OSM. Rendered shapes/colliders fit
  oriented rectangles; courtyards, concave footprints and overhangs are not reproduced.
- Heights: explicit OSM heights (including overlapping building parts), then `building:levels × 3.6 m`.
  Buildings without either use a deterministic 24/55 m estimate based on footprint area.
  Provenance is stored per building; current counts are in `report.json`.
- Landmark overrides use approximate overall heights to preserve the skyline: Willis 442 m,
  Trump 423 m including spire, Marina City 179 m, Tribune 141 m, Wrigley up to 134 m;
  a lower Wrigley component retains its OSM-part height when available.
- Style classification uses names, height and construction year where present. It is a visual
  approximation, not an architectural inventory. Materials are flat vertex colors, without textures.
- Street widths use tagged width, otherwise lane count × 3.2 m, with a 9–26 m fallback envelope.
  Buildings and road geometry can disagree where OSM is incomplete or the rectangle approximation expands a footprint.
- The Loop street datum is flat at 0 m. Sidewalks +0.16 m, river water -5.5 m and Riverwalk -3.8 m
  are schematic local elevations, not DEM/LiDAR measurements. Quay walls show
  the level difference. Only OSM `water=river` receives this treatment; small pools and fountains are omitted.
  Full Lower Wacker/tunnel interiors are excluded.
- Street bridges share the street datum, with a 0.85 m structural underside and simple solid parapets.
  Structural decks extend across the lowered terraces and 2 m into land; simple bank abutments
  support the spans. Parapets continue across the terraces and stop before the land junctions. Bridge mechanics and exact slopes are omitted.
- Elevated L uses above-ground CTA `railway=subway` ways; mainline rail, yards and tunnels are excluded.
  Shared nodes and short fragments are merged before clipping. Adjacent tracks share a continuous
  closed deck with a top at 6 m and underside at 5.65 m; rails and supports are generated offline.
  Building rectangles are fitted to supported land outside street paving and the track corridor,
  on the editor grid. A bounded search shrinks dimensions in 5% steps and may recenter inside
  the original footprint. Width/depth stay at least 5 m and area at least 25% of the original;
  otherwise the object is omitted. The full 1.03× trim envelope must fit. Detailed station buildings/platforms are not modeled.
- Trees and lamps are procedurally spaced along eligible streets. They are not individually surveyed
  positions; lamps are geometry, without hundreds of real light sources. No trains, traffic or interiors.

Architectural reference sources:

- Willis Tower (SOM): https://www.som.com/projects/willis-tower-formerly-sears-tower/
- Marina City (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/marina-city/
- Wrigley Building (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/wrigley-building/
- Tribune Tower (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/tribune-tower/
- Riverwalk vertical arrangement: https://www.rudybruneraward.org/wp-content/uploads/2017/06/Chicago_Riverwalk_FULL.pdf

Generated building anchors snap to 1 m in X/Z, dimensions to 0.25 m and yaw to 15°.
The Y centre is half the snapped height, keeping the base at street level. Procedural street contours retain their own geometric precision.

Untyped, unnamed elevated `building=yes` structures without height or levels are omitted rather than turned into estimated ground-level towers. OSM `layer` is not a metric elevation.

Surface boundaries are snapped only before polygon operations; intersections retain shared coordinates.
Ground is triangulated before cell batching, and raised paving gets closed side faces down to ground level.
Generation checks complete map coverage; geometry tests also verify that every paving boundary has a side face.

Architectural trim uses a shared material with `zOffset = zOffsetUnits = -1` to win depth ties
against the body. Each LOD keeps at most two material submeshes; geometry and colliders are unchanged.

Generation asserts support for every building; tests independently check serialized terrain coverage,
street/sidewalk exclusion and a grounded base. Fit/omission counts are recorded in `report.json`.

Landmark references, distinctive Art Deco profiles and buildings at least 150 m tall are placed first and may not be omitted.
They retain height, can move at most 32 m per axis, and shrink only by a common horizontal scale
(no more than 50%). Failure stops generation instead of silently dropping the landmark.
Repeated Marina profiles are an identical ensemble: equal square diameter, height and orientation,
with one translation/scale preserving their relative positions. Ordinary buildings fit around
reserved landmark footprints. `protectedBuildings` in the report lists all protected IDs.

Architectural primitive contacts are checked at every LOD using convex-solid SAT, including
containment and tangent contact. Each part must connect through other parts to the base;
intersecting bounding boxes alone do not establish support. Street furniture uses ray-tested
ground anchors and its current template half-height rather than a fixed sidewalk elevation.

Street generation includes primary/secondary/tertiary/trunk link ways and keeps short connectors.
Before buffering, forward-facing endpoint gaps up to 12 m are joined; noded branches shorter
than 60 m with an internal dead end or a redundant return loop are pruned (map-edge exits are retained). The largest
connected asphalt component is kept, holes under 64 m² become asphalt, and markings/furniture
use the retained centre lines only. Buildings are fitted after road cleanup; they never carve streets.
These are deliberate blockout simplifications, not a lane-accurate interchange simulation.

Railway frames have two columns, concrete feet, a transverse beam and two knee braces.
Deck candidates are sampled every 4 m; frames use the local perpendicular with at most 10° skew.
Feet may stand on sidewalks/curbs (+0.16 m) or solid ground (0 m), never on asphalt or lowered banks.
The 0.65 m feet must fit entirely. Columns end at +6.05 m for a deck top at +6 m.
Each foot stays within 4 m of its deck edge and the structural span is capped at 14 m;
there is no search for distant curbs and no wide diagonal frame. A short cantilever covers
inward-shifted columns. Frames are spaced at least 20 m apart, with additional safe sites
retained around bends. Tests check feasible-site coverage, pairing, footprint clearance,
local skew, beam contact and actual rendered geometry. Wide road crossings without two
nearby safe feet remain clear spans instead of receiving columns in traffic lanes.

River crossings receive two simple steel side trusses: lower/upper chords, posts, alternating
diagonals and upper transverse ties touching the railway underside. Parallel tracks are grouped
into one crossing; side walls follow the road-bridge width where available, otherwise the rail
corridor width. Each crossing uses 2–8 panels (about 12 m each), without decorative latticework,
bridgehouses or opening machinery. Geometry remains cell/material batched.

Standalone railway trusses extend both chords onto the upper banks beyond the lowered
riverwalk, with their lower faces at ground level. Generation fails if no safe bank
can be reached within 256 m; endpoint clearance is covered by geometry tests.


Traffic signals use a deliberately sparse, stylized offline layout: two posts per
full crossing of primary/secondary/trunk streets, facing incoming traffic from the
two street axes. Simple T junctions, bends, dead ends, residential/tertiary streets
and links stay clear; nearby duplicate nodes are suppressed only within 8 m. OSM oneway
(including -1) is respected. Posts occupy sidewalks at least 0.6 m from asphalt;
lamps and generated trees leave space around them. Far-side placement is informed
by FHWA MUTCD Chapter 4D:
https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/mutcd11theditionhl.pdf
The two-post game convention intentionally does not reproduce its full signal-face
requirements. No traffic warrants, surveyed signal locations, pedestrian signals,
turn arrows or live phases are modeled: the template displays static red. Geometry
is shared and collidable independently of visual LOD.


Signalized junction layouts share the actual road-arm geometry: up to four perimeter
crosswalks are placed independently of signal-pole positions. Their 3 m walking bands
continue the sidewalk routes beyond the corner apex; narrow/oblique sections are
searched up to 2 m farther out and skipped when safe connections cannot be found.
The two signal posts occupy the corner pockets, outside the walking bands and their
1.2 m sidewalk entries. OSM one-way direction determines incoming approaches. Stop
bars have 0.4 m thickness and a 1.3 m clear gap before the nearest zebra edge; on
two-way streets they cover only the right-hand incoming half of the carriageway.
Outgoing one-way arms have no stop bar. Paint is clipped to asphalt and batched without
collisions at y=0.055; centre-line dashes leave crossing/stop-bar areas clear.
Placement follows simplified principles from MassDOT Chapter 6:
https://www.mass.gov/info-details/pddg-chapter-6-intersections
and FHWA MUTCD Chapter 4D. Curbs remain stepped: accessible curb ramps and surveyed
intersection geometry are not modeled yet.

Divided roads retain separate carriageway junction nodes, including continuations
whose OSM class changes to tertiary. Short connecting links between adjacent nodes
do not receive redundant crosswalks across the median. Other perimeter crossings
cover both carriageways. Safe pole space excludes a 0.65 m asphalt buffer before
searching, so narrow corners do not fail merely because the nearest point was too
close to traffic. Incoming arms not covered by a primary head receive additional
heads on an existing pole. Relative head angles snap to 15 degrees so geometry
remains shared; head-facing tests allow only small angular error.


Small street details have a full and a simplified render LOD, updated on the
existing 0.15 s LOD tick. Markings use full geometry below 60 m, flat dashes and
two crossing-edge lines from 60–160 m, then disappear. Railway frames/trusses
simplify at 100 m (no knee/diagonal braces or foot blocks) and disappear beyond
320 m. Detail batches use 128 m cells; terrain/decks keep 256 m batches. LOD
distances use the nearest point of the shared full-detail bounds, so a batch's
two versions cannot appear together. Render visibility does not disable collision
geometry. Lamps simplify their poles and disappear at 120 m; signal heads omit
inactive lenses at low LOD and disappear at 160 m. Selected editable objects
remain visible for manual LOD preview.


Gameplay broad-phase queries cache nearby collision meshes rather than scanning all
render meshes per simulation step. Ground rays and Babylon moveWithCollisions share
the same surroundingMeshes list; the follow camera has a separate range-aware list.
Lists refresh after 4 m of travel or increased camera range, with an 8 m safety
margin. Rebuilds, editor changes, respawns and cell activation invalidate them;
cell activation precedes physics at the destination. This cache assumes the current
static city; moving obstacles must invalidate it or join a separate dynamic list.


Static architecture/furniture hierarchies freeze their world matrices during play,
including visual LOD instances and collision meshes. Entering the editor unfreezes
them; returning to play freezes the edited transforms. The animated player remains
unfrozen. Gizmo utility layers and automatic pointer picking are disabled in play
and restored in the editor; explicit ground/camera raycasts remain active.
