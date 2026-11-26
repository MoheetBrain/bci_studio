# Third-party notices

The full manifest, with versions, files and obligations, is in `docs/LICENCES.md`.

## Brain atlas data — 3D Slicer License

The geometry and labels in `public/atlas/spl-nac/` are derived from the SPL/NAC (SPL-PNL) Brain Atlas, Surgical
Planning Laboratory and Psychiatry Neuroimaging Laboratory, Brigham and Women's Hospital, obtained from
https://github.com/mhalle/spl-brain-atlas at commit `bec24db25aad5f7600e2df3becfb1f883e61ff56`.

> Halle M, Talos I-F, Jakab M, Makris N, Meier D, Wald L, Fischl B, Kikinis R. Multi-modality MRI-based Atlas of the
> Brain. Surgical Planning Laboratory, Brigham and Women's Hospital; 2017.

The atlas was developed with support from the National Institutes of Health under grants P41 EB015902/RR/NIBIB
(Neuroimage Analysis Center), P41 RR013218/RR/NCRR and R01 MH050740/MH/NIMH, a Google Research Grant and other
sources (from the atlas README).

All or portions of this licensed product (such portions are the "Software") have been obtained under license from The
Brigham and Women's Hospital, Inc. and are subject to the terms and conditions of the 3D Slicer License, whose full
text accompanies the data at
`public/atlas/LICENSE-3D-Slicer.txt` (retrieved 2026-11-17 from
https://raw.githubusercontent.com/Slicer/Slicer/main/License.txt). **The data here are a modified version, not the
original** (triangle decimation, quantisation, re-encoding); see `docs/ATLAS_PROVENANCE.md`. The atlas is one
volunteer's anatomy, was designed for research purposes only, and clinical applications are neither recommended nor
advised.

## brain-atlas (conversion pipeline) — MIT

`tools/atlas/vtk.mjs` is adapted from `scripts/vtk.mjs`, and `tools/atlas/build-atlas.mjs` follows the structure of
`scripts/convert.mjs` and `scripts/atlas-tree.mjs`, in https://github.com/glin23/brain-atlas at commit
`65502a79276952290c47f73524c8d548eb1ea6b4`.

```
MIT License

Copyright (c) 2026 Lee Lin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## H01 release — one reconstructed neuron

`public/world/h01-exemplar.json` contains the skeleton (branch geometry and calibre) of one proofread cell, segment
`2252715458`, of the H01 release: a cubic millimetre of human temporal cortex imaged by serial-section electron
microscopy and segmented automatically (Google Research; Lichtman Laboratory, Harvard University).

Licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0),
https://creativecommons.org/licenses/by/4.0/ — source: https://h01-release.storage.googleapis.com/data.html

Please cite: Shapson-Coe A, Januszewski M, Berger DR, et al. A petavoxel fragment of human cerebral cortex
reconstructed at nanoscale resolution. Science 384, eadk4858 (2024). doi:10.1126/science.adk4858

Modified for this studio: converted to micrometres, rotated into the cell's own frame, the nodes inside the cell body
merged, each unbranched stretch simplified to within 0.18 µm, and drawn as tubes. It is shown as structure only; no
model in this studio computes anything in it, and its authors do not endorse this use.

## npm packages

meshoptimizer (MIT, © Arseny Kapoulkine), three and three-mesh-bvh (MIT), React (MIT), React Three Fiber and Drei
(MIT), React Flow (MIT), Zustand (MIT), Vite (MIT), TypeScript (Apache-2.0), playwright-core (Apache-2.0). Their
licence files are in `node_modules/<package>/`.
