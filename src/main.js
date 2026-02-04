import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { ViewportGizmo } from 'three-viewport-gizmo';


// SCENE SETUP
const scene = new THREE.Scene();
const canvReference = document.getElementById("poser_canvas");
scene.background = new THREE.Color("rgb(160, 160, 160)");

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.9, 2.75);
camera.layers.enableAll();


const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvReference
});

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);


// VIEWPORT GIZMO SETUP

const gizmo = new ViewportGizmo(camera, renderer, {
    container: document.body,
    type: 'sphere',
    placement: 'bottom-right',
    size: 100,
    
    // background circle thing
    background: {
        enabled: true,
        color: '#cccccc', 
        opacity: 1
    },

    // axises
    x: {
        color: '#000000',     
        labelColor: '#ffffff', 
        label: 'X'
    },
    y: {
        color: '#000000',      
        labelColor: '#ffffff', 
        label: 'Y'
    },
    z: {
        color: '#000000',      
        labelColor: '#ffffff', 
        label: 'Z'
    },

    // the opposite side (dots w/o letters)
    nx: { color: '#888888' }, 
    ny: { color: '#888888' },
    nz: { color: '#888888' },

    offset: { 
        
        right: 50, 
        bottom: 40  
    }

});


// attach orbit controls to gizmo

gizmo.attachControls(orbit);
gizmo.update();




// LIGHTING SETUP
const light = new THREE.PointLight(0xffffff, 20);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);

light.position.set(2, 3, 2);


// ohhhhh if only i could figure out how on earth to properly attach transform controls to the light

// const helper = new THREE.PointLightHelper(light, 1);
scene.add(hemiLight, light);


// GRID SETUP

// settings
const size = 200;            // Physical size of the plane
const divisions = 10;        // How many "Major Blocks" (10x10 units) to repeat
const majorColor = '#000000';
const minorColor = '#000000b6';

// grid texture setup
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = 2048; // High resolution for sharpness
canvas.height = 2048;

const step = canvas.width / 10; // 10 sub-squares

ctx.clearRect(0, 0, canvas.width, canvas.height);

// draw the grid (thinner lines)
ctx.lineWidth = 2; 
ctx.strokeStyle = minorColor;
for (let i = 0; i <= 10; i++) {
    // vertical
    ctx.beginPath();
    ctx.moveTo(i * step + 0.5, 0); ctx.lineTo(i * step + 0.5, canvas.height);
    ctx.stroke();
    // horizontal
    ctx.beginPath();
    ctx.moveTo(0, i * step + 0.5); ctx.lineTo(canvas.width, i * step + 0.5);
    ctx.stroke();
}

// draw major lines
ctx.lineWidth = 7;
ctx.strokeStyle = majorColor;
ctx.strokeRect(0, 0, canvas.width, canvas.height);

const gridTexture = new THREE.CanvasTexture(canvas);
gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;
gridTexture.repeat.set(divisions, divisions);

// sharpness settings
gridTexture.magFilter = THREE.LinearFilter;
gridTexture.minFilter = THREE.LinearMipMapNearestFilter;

// alpha map setup (for softer edges)
const alphaCanvas = document.createElement('canvas');
alphaCanvas.width = 512;
alphaCanvas.height = 512;
const alphaCtx = alphaCanvas.getContext('2d');

const grad = alphaCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Center: Visible
grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Edge: Invisible

alphaCtx.fillStyle = grad;
alphaCtx.fillRect(0, 0, 512, 512);
const alphaMap = new THREE.CanvasTexture(alphaCanvas);

// assembly mmmmm i'm hungry
const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: gridTexture,
    alphaMap: alphaMap,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false, 
});

const geometry = new THREE.PlaneGeometry(size, size);
const grid = new THREE.Mesh(geometry, material);
grid.rotation.x = -Math.PI / 2;
grid.layers.set(1);

scene.add(grid);



// GLOBAL VARIABLES

let ikSolver, bodyMesh, skeleton;
let isIKMode = false;
let isDraggingTorus = false;
let activeIKIndex = -1;
let activeHandle = null; 

const ikHandles = []; 
const ikTargetsMap = new Map(); 
const targetWorldPositions = new Map(); 
const _tempVec = new THREE.Vector3();   

const pickingMeshes = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const dragPlane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const intersection = new THREE.Vector3();




// SCREENSHOT 

document.getElementById('camera-btn').onclick = () => {
    camera.layers.set(0);
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = 'hand-pose.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
    camera.layers.enableAll();
};



// UNDO/REDO 

document.getElementById('undo-btn').onclick = () => undo();
document.getElementById('redo-btn').onclick = () => redo();


const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

function saveState() {
    if (!skeleton) return;
    
    // capture all bone rotations and translations
    const state = skeleton.bones.map(bone => ({
        name: bone.name, // here incase we want to keep track of which bone
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone()
    }));

    
    undoStack.push(state);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    
    // clear redo stack whenever a new action is performed
    redoStack.length = 0;
    updateButtonVisuals();
}

function undo() {
    if (undoStack.length <= 1) return; // keep at least the initial state

    const currentState = undoStack.pop();
    redoStack.push(currentState);

    applyState(undoStack[undoStack.length - 1]);
}

function redo() {
    if (redoStack.length === 0) return;

    const nextState = redoStack.pop();
    undoStack.push(nextState);

    applyState(nextState);
}

function applyState(state) {
    if (!skeleton || !state) return;

    state.forEach((boneState, index) => {
        const bone = skeleton.bones[index];
        if (bone) {
            bone.quaternion.copy(boneState.quaternion);
            bone.position.copy(boneState.position);
            // force update
            bone.updateMatrixWorld();
        }
    });
    
    updateButtonVisuals();
}

// update UI opacity or disabled state based on stack length
function updateButtonVisuals() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if(undoBtn) undoBtn.style.opacity = undoStack.length > 1 ? "1" : "0.3";
    if(redoBtn) redoBtn.style.opacity = redoStack.length > 0 ? "1" : "0.3";
}


// TRANSFORM CONTROLS SETUP
const transformCtrl = new TransformControls(camera, renderer.domElement);

// for mode switching
function setMode(mode) {
    transformCtrl.setMode(mode);
    console.log(`Current Mode: ${mode}`);
}



// buttons
document.getElementById('translate').onclick = () => setMode('translate');
document.getElementById('rotate').onclick = () => setMode('rotate');


// keyboard shortcuts 
window.addEventListener('keydown', (event) => {
    switch (event.key.toLowerCase()) {
        case 't': setMode('translate'); break;
        case 'r': setMode('rotate'); break;      
    }
});

scene.add(transformCtrl.getHelper());
transformCtrl.attach(light);

transformCtrl.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value;
    if (!event.value) {
        saveState();
    }
});



// IK HANDLE CREATION

function createIKHandle() {
    const torusGeom = new THREE.TorusGeometry(0.04, 0.008, 12, 32);
    const torusMat = new THREE.MeshBasicMaterial({ color: 0x149a60, depthTest: false });
    const handle = new THREE.Mesh(torusGeom, torusMat);
    handle.renderOrder = 1000;
    handle.layers.set(1);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    );
    handle.add(hitbox);

    return handle;
}



// LOAD MODEL,SETUP IK SOLVER, ADD FK HANDLES


const loader = new GLTFLoader();
loader.load('/handporcs.glb', (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    

    model.traverse((child) => {
        if (child.isSkinnedMesh) {
            bodyMesh = child;
            skeleton = child.skeleton;
            

            skeleton.bones.forEach((bone, index) => {


                // uncomment for logging bone indices and names
                // console.log(`Bone Index: ${index}, Bone Name: ${bone.name}`)

                if (index === 5 || index === 9 || index === 13 || index === 17 || index >= 21) return;

                

                const container = new THREE.Group();
                bone.add(container);

                const visualMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.02),
                    new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false })
                );
                visualMesh.renderOrder = 999;
                container.add(visualMesh);

                const hitboxMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.3),
                    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 })
                );
                hitboxMesh.userData.targetBone = bone;
                container.add(hitboxMesh);
                pickingMeshes.push(hitboxMesh);
                visualMesh.layers.set(1);
            });
        }
    });

    if (bodyMesh) {
const ikConfig = [

            //index

            { 
                target: 22, effector: 5, 
                links: [
                    { index: 4, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, // Distal
                    { index: 3,  rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, // Middle
                    { index: 2,  rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.3) }  // Proximal
                ], 
                iteration: 5 
            },

            //middle

            { 
                target: 23, effector: 9, 
                links: [
                    { index: 8, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 7, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 6, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.3) }
                ], 
                iteration: 5 
            },

            //ring

            { 
                target: 24, effector: 13, 
                links: [
                    { index: 12, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 11, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 10, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.3) }
                ], 
                iteration: 5 
            },

            //pinky

            { 
                target: 25, effector: 17, 
                links: [
                    { index: 16, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 15, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.1) }, 
                    { index: 14, rotationMin: new THREE.Vector3(0, 0, -1.5), rotationMax: new THREE.Vector3(0, 0, 0.3) }
                ], 
                iteration: 5 
            },

            //thumb

            { 
                target: 26, effector: 21, 
                links: [
                    { index: 20, rotationMin: new THREE.Vector3(-1, 0, 0), rotationMax: new THREE.Vector3(0.2, 0, 0) }, 
                    { index: 19, rotationMin: new THREE.Vector3(-1, 0, 0), rotationMax: new THREE.Vector3(0, 0, 0) },
                    { index: 18, rotationMin: new THREE.Vector3(0.35, -0.1, -0.7), rotationMax: new THREE.Vector3(1, 0.1, 0.3) }
                ], 
                iteration: 8
            }
        ];

        ikSolver = new CCDIKSolver(bodyMesh, ikConfig);

        ikConfig.forEach((config, index) => {
            const handle = createIKHandle();
            handle.userData.fingerIndex = index;
            
            const effectorBone = skeleton.bones[config.effector];
            const targetBone = skeleton.bones[config.target];
            
            effectorBone.add(handle);
            handle.position.set(0, 0.1, 0); 
            
            ikHandles.push(handle);
            ikTargetsMap.set(handle, targetBone); 

            const worldPos = new THREE.Vector3();
            handle.getWorldPosition(worldPos);
            targetWorldPositions.set(targetBone, worldPos);
        });

        saveState(); 
        console.log("Initial state saved");
    }
});






// INTERACTIONS

window.addEventListener('pointerdown', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (transformCtrl.axis !== null) return;

    const intersects = raycaster.intersectObjects(ikHandles, true);
    if (intersects.length > 0) {
        let hitObject = intersects[0].object;
        while (hitObject.parent && !ikHandles.includes(hitObject)) {
            hitObject = hitObject.parent;
        }

        activeHandle = hitObject;
        activeIKIndex = activeHandle.userData.fingerIndex;
        isIKMode = true;
        isDraggingTorus = true;
        orbit.enabled = false;
        transformCtrl.detach();

        activeHandle.material.color.set(0xf1db4c);
        scene.attach(activeHandle);

        planeNormal.copy(camera.position).sub(activeHandle.position).normalize();
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal, activeHandle.position);

        ikSolver.iks.forEach((ik, i) => {
            if (!ik.originalIteration) ik.originalIteration = ik.iteration || 40;
            ik.iteration = (i === activeIKIndex) ? ik.originalIteration : 0;
        });
        return;
    }

    const intersectsBones = raycaster.intersectObjects(pickingMeshes, true);
    if (intersectsBones.length > 0) {
        isIKMode = false;
        const clickedBone = intersectsBones[0].object.userData.targetBone;
        transformCtrl.attach(clickedBone);
        return;
    }
    transformCtrl.detach();

});

window.addEventListener('pointermove', (event) => {
    if (!isDraggingTorus || !activeHandle) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        activeHandle.position.copy(intersection);

        const targetBone = ikTargetsMap.get(activeHandle);
        if (targetBone) {
            targetWorldPositions.set(targetBone, intersection.clone());
        }
    }
});

window.addEventListener('pointerup', () => {
    if (isDraggingTorus && activeHandle) {
        const effectorIndex = ikSolver.iks[activeIKIndex].effector;
        const effectorBone = skeleton.bones[effectorIndex];

        effectorBone.add(activeHandle);
        activeHandle.position.set(0, 0.1, 0);
        activeHandle.rotation.set(0, 0, 0);
        activeHandle.material.color.set(0x149a60);

        isDraggingTorus = false;
        activeHandle = null;
        activeIKIndex = -1;
        orbit.enabled = true;

        saveState(); // capture the final IK pose
        
        isDraggingTorus = false;
        activeHandle = null;
    }
});





window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    gizmo.update();
});





// RENDERING

function animate() {
    requestAnimationFrame(animate);
    
    if (ikSolver && isDraggingTorus) {
        targetWorldPositions.forEach((lockedWorldPos, targetBone) => {
            if (targetBone && lockedWorldPos) {
                _tempVec.copy(lockedWorldPos);
                bodyMesh.worldToLocal(_tempVec);
                targetBone.position.lerp(_tempVec, 0.1); // 0.1 is very smooth/slow, 0.3 is snappier
            }
        });

        ikSolver.update();

        
    }
    

    renderer.render(scene, camera);

    gizmo.render();
}

animate();

//yippie