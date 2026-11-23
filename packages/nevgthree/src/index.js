// NevGThree — public API (3D layer for NevG.js, powered by three.js)
export { Game3D } from './game3d.js';
export { Scene3D, disposeObject } from './scene3d.js';
export { Entity3D, Mesh3D, Model3D } from './entity3d.js';
export { Body3D } from './physics3d.js';
export { OrbitRig, FirstPersonRig, TopDownRig } from './cameras.js';
export { Controls3D } from './controls.js';
export { Terrain, createWater } from './terrain.js';
export { props, createSky } from './props.js';
export { Particles3D } from './fx.js';
export { extendAssets } from './loaders.js';
export * as THREE from 'three';
