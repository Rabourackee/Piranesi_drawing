# Carceri d'Invenzione: a procedural Piranesi etching machine

Draw a few simple strokes. The app reads them as architecture and engraves a plate in the
manner of Piranesi's *Imaginary Prisons*. It uses no AI and no network calls. Everything is
geometry, perspective, seeded noise and hatching.

## Run it

Open `index.html` in a modern browser. There is no build step and nothing to install.
The only external resource is the Google Fonts stylesheet, which has a serif fallback.

Try **Load example** first, or draw your own sketch and press **Etch the plate**.

## Drawing

In **Auto** mode each stroke is classified by its shape:

| Stroke | Becomes |
| --- | --- |
| Vertical line | Rusticated pier with plinth, capital and sometimes an iron ring and chain |
| Horizontal line | Bridge with cornice, balustrade and hanging chains |
| Gentle hump (⌒) | Curved bridge whose deck and railing follow the curve |
| Arc (∩) | Arch with voussoirs and keystone, a receding barrel vault and sometimes a walkway on top |
| Steps or a diagonal | Staircase with railing, solid to the floor or flying |
| Sweeping curve | Staircase whose steps follow your curve |
| Sagging curve (∪) | Chain |
| Wavy vertical drop | Hanging chain with a lantern, hook, weight or ring |
| Closed loop | Barred window. It is lit when above the horizon and a dark cell below it |
| Dot | A tiny gesturing figure |
| Anything else | Rope |

You can also force any element with the tool buttons. Other tools:

- **Shadow and Light** brushes paint the tone directly. Light also cuts shafts through the atmosphere.
- **Erase** removes strokes you touch.
- **Vantage** drags the vanishing point. Every element and the whole hall re-project to it.
- **Depth layer** puts new strokes Near, Middle or Far. Far strokes are thinner and fogged.

Keyboard shortcuts: `A`, `1` to `9`, `S`, `L`, `E` and `V` pick tools. `Enter` etches,
`R` reimagines with a new seed, and `Ctrl+Z` undoes.

## How it works

1. **Reading strokes** (`js/interpret.js`). Each stroke is measured for straightness, corners,
   bulge above or below its chord, wiggle, closure and size. It is then classified and
   regularised: piers snap plumb, arcs become true elliptical arches, loops become
   rectangular, round or free windows.
2. **One-point perspective** (`js/build.js`). A drawn outline lives in a picture plane at depth
   `z` and is extruded toward the vanishing point. Each edge becomes a face. Faces are culled
   against the vanishing point and painter-sorted. Each face gets a tone from a fixed
   upper-left light, and the inside of openings is darkened.
3. **Hatching in surface coordinates.** Receding faces are hatched along their own
   parameters. Lines run to the vanishing point and transverse rings sit at
   perspective-correct depths. The grids are shared along a whole outline, so curved vaults
   hatch continuously. Frontal faces get layered parallel hatching on a global grid. Each
   new layer starts only at a darker threshold, the way etchers build value.
4. **The imagined prison** (`js/hall.js`). Around your sketch, a seeded hall is built in 3D. It
   has a flagstone floor, a timbered ceiling, arcaded side walls, a back wall with a great
   arch and a misty vista beyond. The **Imagination** slider scatters bridges, stairs, piers,
   transverse arches, pulleys, ropes and figures through its depth, using the same builders
   as your strokes. Distance fades the ink as aerial perspective.
5. **Structural sense** (`js/structure.js`). Before anything is drawn, every element, yours
   and imagined, is made to stand up. Piers rest on the floor or a beam. Arches spring from
   what lies under their legs. Stairs start on a surface and arrive on a landing, which is
   built if missing. Bridges are anchored at both ends by the frame edge, a hall wall or a
   solid they butt into, or a new pier is raised under the free end. Windows are cut into
   a wall. Chains, lanterns, ropes and pulleys hang from a soffit, an arch or the vault,
   and figures stand on floors, bridges, landings and treads. Imagined elements start
   behind your own vaults and keep to side lanes along the walls, so the central view
   stays open. Galleries, switchback stairs, colonnades and tackle line the flanks, and at
   most one bridge and one wide transverse arch cross the hall.
   Parts are joined the way a builder would join them:
   - **Wound stairs.** Great piers get stairs wound around them. Flights alternate in front of and behind the shaft, turn on landings corbelled out of its flanks, and arrive at a door cut into the pier.
   - **Beams growing out of supports.** A beam or landing that meets a pier, a wall or the hall wall grows out of it on a corbel, a scrolled console or a timber brace. Short landings cantilever on a row of consoles instead of standing on props.
   - **Arches.** Arches spring from neighbouring piers, and colonnade piers carry a great arch between them.
   - **Landings.** A stair with nowhere to arrive reaches for the nearest pier or wall.
6. **Variety** (`Build.style` in `js/build.js`). Each element gets its own look from the seed:
   - **Piers:** square rusticated, banded with worm-eaten rustication, rubble, pilastered, round fluted columns, or round towers with curved coursing and arrow slits. Capitals and plinths vary too.
   - **Bridges:** flat, carried on an arch, or timber. Railings can be balusters, wrought iron, a solid parapet, timber posts with rope, or a broken balustrade.
   - **Arches:** round or segmental, with voussoirs, alternating long and short blocks, smooth bands, or rough rusticated stones. Keystones are plain, proud or scrolled.
   - **Stairs:** solid, vaulted underneath, flying, or spiral.
   - **Windows:** grilles of bars, lattice, radial spokes or wrenched bars.
7. **Damage as a final step.** After each element is built, time breaks it. A breach cuts a ragged hole right through a wall, revealing the space behind and the broken thickness of the masonry, with fallen stones on its lip. A spall erases the carved detail in a patch and replaces it with recessed, fractured stone whose upper rim lies in shadow.
8. **Time and neglect** (`js/wear.js`, the Ruin & wear slider). Outlines are chipped and notched before extrusion, so the damage has depth. Free-standing piers, columns and arch walls end in broken, stepped tops. Blocks fall out, cracks branch, water streaks the walls, and weeds, shrubs and vines take root. Rubble and fallen column drums lie on the floor.
9. **The hand** (`js/plate.js`, the Hand tremor and Sketchiness sliders). Lines are never ruled. Every stroke bows slightly, trembles, and overshoots or stops short. No line is ever long or straight. Every path first wanders off true with slow noise, then is laid down as a chain of short strokes, each tilted a little off the last and mostly overlapping it, sometimes gone over twice, each with its own pressure. Contours are redrawn edge by edge, crossing at the corners, sometimes with a faint first attempt beside them. Hatching is not clipped to the faces: each line finds its own way in and out. Faint perspective construction lines stay visible, as in a real drawing.
10. **Atmosphere** (`js/tone.js`). A darkness field combines a vignette over the vaults, smoky
   noise, cast shadows, light shafts from barred windows and your brush. Lines march across
   the plate at several angles and are bitten only where the field passes each layer's
   threshold.
11. **The print** (`js/paper.js`, `js/plate.js`). Every mark is a wobbly, width-jittered,
   occasionally broken line. Marks are recorded as operations and replayed progressively, so
   you watch the burin work. The ink is multiplied onto procedurally aged paper with grain,
   fibres, foxing, a plate mark and plate tone.

Every plate is reproducible from its seed, which is shown in the status bar and in the
saved file name.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Page and styles |
| `js/app.js` | Sketch input, tools, views, sliders, animation and export |
| `js/engine.js` | Composes the scene into burin operations |
| `js/interpret.js` | Stroke analysis and classification |
| `js/build.js` | Prism extrusion, masonry, element styles and all architectural elements |
| `js/wear.js` | Chips, broken tops, cavities, cracks, streaks, vegetation and rubble |
| `js/structure.js` | Makes every element structurally supported |
| `js/hall.js` | The procedurally imagined prison |
| `js/tone.js` | Atmospheric darkness field and tonal hatching |
| `js/plate.js` | Ink-line primitives, hatching and playback |
| `js/paper.js` | Paper and plate mark |
| `js/rng.js`, `js/geom.js` | Seeded random and noise, and 2D geometry |
| `js/example.js` | Demo sketches |

URL options for testing: `?demo=1` loads the example, `?demo=2` a sparse one, `?demo=3` a sampler of curved and varied forms, `?demo=4` two great pillars for the wound stairs, and `?demo=0` an empty sketch. Any slider can be set by name, for example `&wear=1`, and `&vpx=…&vpy=…` sets the vanishing point. Add
`&noanim=1` to skip the animation, `&seed=N` to fix the seed, `&view=etch|overlay|sketch`
to pick a view, and `&full=1` for a bare 800px capture view.
