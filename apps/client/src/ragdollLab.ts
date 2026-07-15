import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GUI from 'lil-gui';
import bunnyGlbUrl from './assets/models/characters/Mesh_BunnyChar_00.glb';
import {
  createBunnyRagdoll,
  initRagdollPhysics,
  listSkeletonBoneNames,
  type BunnyRagdoll,
  type RagdollDebugBody,
} from './bunnyRagdoll';
import { captureBonePose, createPoseBlend, type BonePoseSample } from './ragdollBlend';
import { ragdollTuning, resetRagdollTuning } from './ragdollTuning';

const TARGET_HEIGHT = 1.8;
const CLIP_IDLE = 'idle_bounce';
const GETUP_RAMP_SEC = 1.0;
const HINT_FAIL = 'Ragdoll failed: missing bones';
const TUNING_STORAGE_KEY = 'crowntag-ragdoll-tuning';
const KNOCKDOWN_MAX_SEC = 2.5;
const SETTLE_HOLD_SEC = 0.25;
const RECOVER_BLEND_SEC = 0.35;
const JITTER_WINDOW_SEC = 0.5;

type LabMode = 'idle' | 'stand' | 'tumble' | 'getup' | 'knockdown' | 'recover';

type LastEnableOpts =
  | { kind: 'stand' }
  | { kind: 'tumble'; vx: number; vz: number };

declare global {
  interface Window {
    __ragdollLab?: {
      fireTumble: () => void;
      stand: () => void;
      getUp: () => void;
      idleClip: () => void;
      replay: () => void;
      knockdownRecover: () => void;
      ragdoll: BunnyRagdoll;
      getHipsY: () => number | null;
      listBones: () => string[];
    };
  }
}

const _hipsWorld = new THREE.Vector3();
const _dbgPos = new THREE.Vector3();
const _dbgQuat = new THREE.Quaternion();

function loadTuningFromStorage(): void {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof ragdollTuning>;
    if (parsed && typeof parsed === 'object') {
      Object.assign(ragdollTuning, parsed);
    }
  } catch {
    // ignore invalid storage
  }
}

function saveTuningToStorage(): void {
  try {
    localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(ragdollTuning));
  } catch {
    // ignore quota / private mode
  }
}

async function main() {
  await initRagdollPhysics();
  loadTuningFromStorage();

  const gltf = await new GLTFLoader().loadAsync(bunnyGlbUrl);
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 1e-6 ? TARGET_HEIGHT / size.y : 1;
  const yOffset = -box.min.y * scale;
  model.scale.setScalar(scale);
  model.position.y = yOffset;

  const characterRoot = new THREE.Group();
  characterRoot.name = 'ragdollLabCharacter';
  characterRoot.rotation.y = Math.PI;
  characterRoot.add(model);

  characterRoot.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a20);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(3.2, 2.4, 4.5);
  camera.lookAt(0, 0.8, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x3a3028, 0.85));
  const dir = new THREE.DirectionalLight(0xfff2dd, 1.1);
  dir.position.set(4, 8, 3);
  dir.castShadow = true;
  scene.add(dir);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(20, 20, 0x4a4a58, 0x303038);
  grid.position.y = 0.001;
  scene.add(grid);

  scene.add(characterRoot);

  const hint = document.getElementById('hint');
  const setHint = (text: string, color?: string) => {
    if (!hint) return;
    hint.textContent = text;
    hint.style.color = color ?? '';
  };

  // Bind-pose locals before idle/ragdoll mutate bones — used to stand up after tumble.
  type BoneBind = {
    bone: THREE.Bone;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  };
  const bindPose: BoneBind[] = [];
  characterRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Bone)) return;
    bindPose.push({
      bone: obj,
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });

  const bindPoseSamples: BonePoseSample[] = bindPose.map((b) => ({
    bone: b.bone,
    position: b.position.clone(),
    quaternion: b.quaternion.clone(),
  }));

  // Cache bind-pose joint anchors before idle animation moves bones.
  const ragdoll = createBunnyRagdoll(characterRoot);
  if (!ragdoll.ok) {
    setHint(HINT_FAIL, '#ff6b6b');
  }

  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  const idleClip = gltf.animations.find((c) => c.name === CLIP_IDLE);
  if (idleClip) {
    mixer = new THREE.AnimationMixer(model);
    idleAction = mixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.play();
  }

  let hipsBone: THREE.Bone | null = null;
  characterRoot.traverse((obj) => {
    if (hipsBone) return;
    if (!(obj instanceof THREE.SkinnedMesh) || !obj.skeleton) return;
    for (const bone of obj.skeleton.bones) {
      if (bone.name === 'hips') {
        hipsBone = bone;
        break;
      }
    }
  });

  function getHipsY(): number | null {
    if (!hipsBone) return null;
    hipsBone.getWorldPosition(_hipsWorld);
    return _hipsWorld.y;
  }

  function restoreBindPose() {
    for (const b of bindPose) {
      b.bone.position.copy(b.position);
      b.bone.quaternion.copy(b.quaternion);
      b.bone.scale.copy(b.scale);
    }
    characterRoot.updateMatrixWorld(true);
    characterRoot.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh && obj.skeleton) obj.skeleton.update();
    });
  }

  let mode: LabMode = 'idle';
  let getUpT = 0;
  let debugEnabled = true;
  let lastEnableOpts: LastEnableOpts | null = null;
  let poseBlend: ReturnType<typeof createPoseBlend> | null = null;
  let knockdownElapsed = 0;
  let settleHold = 0;
  let tumbleStartTime: number | null = null;
  let settleReported: number | null = null;
  let timeScale = 1;
  let paused = false;
  let stepOnce = false;
  const jitterSamples: { t: number; angvel: number }[] = [];
  let simClock = 0;

  // --- lil-gui tuning panel ---
  const gui = new GUI({ title: 'Ragdoll Tuning' });
  const physicsFolder = gui.addFolder('Physics');
  physicsFolder.add(ragdollTuning, 'gravityY', -40, 0, 0.1).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'linearDamping', 0, 10, 0.05).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'impulseScale', 0, 2, 0.01).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'impulseUp', 0, 10, 0.05).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'angularKick', 0, 20, 0.1).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'maxLinvel', 1, 40, 0.5).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'maxAngvel', 1, 60, 0.5).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'massDensity', 10, 200, 1).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'solverIterations', 1, 32, 1).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'revoluteLimitMin', -Math.PI, Math.PI, 0.05).onChange(saveTuningToStorage);
  physicsFolder.add(ragdollTuning, 'revoluteLimitMax', -Math.PI, Math.PI, 0.05).onChange(saveTuningToStorage);

  const poseFolder = gui.addFolder('Pose PD');
  poseFolder.add(ragdollTuning, 'kpOrient', 0, 200, 1).onChange(saveTuningToStorage);
  poseFolder.add(ragdollTuning, 'kdOrient', 0, 50, 0.5).onChange(saveTuningToStorage);
  poseFolder.add(ragdollTuning, 'maxTorque', 0, 100, 1).onChange(saveTuningToStorage);
  poseFolder.add(ragdollTuning, 'kpHipsUpright', 0, 100, 1).onChange(saveTuningToStorage);
  poseFolder.add(ragdollTuning, 'kdHipsUpright', 0, 50, 0.5).onChange(saveTuningToStorage);

  const secondaryFolder = gui.addFolder('Secondary');
  secondaryFolder.add(ragdollTuning, 'secondarySpringKp', 0, 100, 1).onChange(saveTuningToStorage);
  secondaryFolder.add(ragdollTuning, 'secondarySpringKd', 0, 50, 0.5).onChange(saveTuningToStorage);

  const coneFolder = gui.addFolder('Cone');
  coneFolder.add(ragdollTuning, 'torsoConeLimit', 0, Math.PI, 0.05).onChange(saveTuningToStorage);
  coneFolder.add(ragdollTuning, 'headConeLimit', 0, Math.PI, 0.05).onChange(saveTuningToStorage);
  coneFolder.add(ragdollTuning, 'coneClampKp', 0, 100, 1).onChange(saveTuningToStorage);

  const timestepFolder = gui.addFolder('Timestep');
  timestepFolder.add(ragdollTuning, 'fixedDt', 1 / 240, 1 / 30, 1 / 240).onChange(saveTuningToStorage);
  timestepFolder.add(ragdollTuning, 'maxSubsteps', 1, 16, 1).onChange(saveTuningToStorage);

  const timeState = { timeScale: 1, paused: false };
  const timeFolder = gui.addFolder('Time');
  timeFolder
    .add(timeState, 'timeScale', { '1×': 1, '0.25×': 0.25, '0.1×': 0.1 })
    .name('timeScale')
    .onChange((v: number) => {
      timeScale = v;
    });
  timeFolder
    .add(timeState, 'paused')
    .name('Pause')
    .onChange((v: boolean) => {
      paused = v;
    });
  timeFolder
    .add(
      {
        step() {
          if (paused) stepOnce = true;
        },
      },
      'step',
    )
    .name('Single-step');

  gui
    .add(
      {
        resetDefaults() {
          resetRagdollTuning();
          for (const c of gui.controllersRecursive()) c.updateDisplay();
          saveTuningToStorage();
        },
      },
      'resetDefaults',
    )
    .name('Reset defaults');
  gui
    .add(
      {
        copyJson() {
          void navigator.clipboard.writeText(JSON.stringify(ragdollTuning, null, 2));
        },
      },
      'copyJson',
    )
    .name('Copy JSON');

  // --- Debug capsule overlays ---
  const debugRoot = new THREE.Group();
  debugRoot.name = 'ragdollDebug';
  scene.add(debugRoot);
  const debugMeshes = new Map<string, THREE.Mesh>();
  const debugJointSpheres = new Map<string, THREE.Mesh>();
  const capsuleMat = new THREE.MeshBasicMaterial({
    color: 0x4ecdc4,
    wireframe: true,
    depthTest: true,
    transparent: true,
    opacity: 0.85,
  });
  const jointMat = new THREE.MeshBasicMaterial({
    color: 0xffb347,
    depthTest: true,
    transparent: true,
    opacity: 0.7,
  });

  function disposeDebug() {
    for (const mesh of debugMeshes.values()) {
      debugRoot.remove(mesh);
      mesh.geometry.dispose();
    }
    debugMeshes.clear();
    for (const mesh of debugJointSpheres.values()) {
      debugRoot.remove(mesh);
      mesh.geometry.dispose();
    }
    debugJointSpheres.clear();
  }

  function syncDebug(bodies: RagdollDebugBody[]) {
    if (!debugEnabled || bodies.length === 0) {
      disposeDebug();
      return;
    }
    const seen = new Set<string>();
    for (const b of bodies) {
      seen.add(b.name);
      let mesh = debugMeshes.get(b.name);
      // CapsuleGeometry(radius, length) where length = 2 * halfHeight
      const length = b.halfHeight * 2;
      if (!mesh) {
        const geo = new THREE.CapsuleGeometry(b.radius, length, 4, 8);
        mesh = new THREE.Mesh(geo, capsuleMat);
        debugMeshes.set(b.name, mesh);
        debugRoot.add(mesh);
      } else {
        const prev = mesh.userData as { r?: number; h?: number };
        if (prev.r !== b.radius || prev.h !== b.halfHeight) {
          mesh.geometry.dispose();
          mesh.geometry = new THREE.CapsuleGeometry(b.radius, length, 4, 8);
        }
      }
      (mesh.userData as { r: number; h: number }).r = b.radius;
      (mesh.userData as { r: number; h: number }).h = b.halfHeight;

      _dbgPos.set(b.translation.x, b.translation.y, b.translation.z);
      _dbgQuat.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
      mesh.position.copy(_dbgPos);
      mesh.quaternion.copy(_dbgQuat);

      let joint = debugJointSpheres.get(b.name);
      if (!joint) {
        joint = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), jointMat);
        debugJointSpheres.set(b.name, joint);
        debugRoot.add(joint);
      }
      joint.position.copy(_dbgPos);
    }
    for (const name of [...debugMeshes.keys()]) {
      if (seen.has(name)) continue;
      const mesh = debugMeshes.get(name)!;
      debugRoot.remove(mesh);
      mesh.geometry.dispose();
      debugMeshes.delete(name);
      const joint = debugJointSpheres.get(name);
      if (joint) {
        debugRoot.remove(joint);
        joint.geometry.dispose();
        debugJointSpheres.delete(name);
      }
    }
  }

  function stopMixer() {
    if (idleAction) idleAction.stop();
    if (mixer) mixer.stopAllAction();
  }

  function restartIdle() {
    restoreBindPose();
    if (!mixer || !idleAction) return;
    mixer.stopAllAction();
    idleAction.reset();
    idleAction.play();
  }

  function markScenarioStart() {
    tumbleStartTime = simClock;
    settleReported = null;
    jitterSamples.length = 0;
  }

  function updateJitter(angvel: number, effectiveDt: number) {
    if (effectiveDt <= 0) return;
    simClock += effectiveDt;
    jitterSamples.push({ t: simClock, angvel });
    const cutoff = simClock - JITTER_WINDOW_SEC;
    while (jitterSamples.length > 0 && jitterSamples[0]!.t < cutoff) {
      jitterSamples.shift();
    }
  }

  function meanJitter(): number {
    if (jitterSamples.length === 0) return 0;
    let sum = 0;
    for (const s of jitterSamples) sum += s.angvel;
    return sum / jitterSamples.length;
  }

  function updateStatusHint() {
    if (!ragdoll.ok) {
      setHint(HINT_FAIL, '#ff6b6b');
      return;
    }
    const hipsY = getHipsY();
    const hipsStr = hipsY != null ? hipsY.toFixed(2) : '—';
    const str = ragdoll.getPoseStrength().toFixed(2);
    const m = ragdoll.getMetrics();
    const jitter = meanJitter();
    if (
      tumbleStartTime != null &&
      settleReported == null &&
      ragdoll.active &&
      ragdoll.isSettled()
    ) {
      settleReported = simClock - tumbleStartTime;
    }
    const settleStr =
      settleReported != null
        ? settleReported.toFixed(2)
        : tumbleStartTime != null && (mode === 'tumble' || mode === 'knockdown' || mode === 'getup')
          ? '—'
          : '—';
    setHint(
      `mode=${mode}  pose=${str}  hipsY=${hipsStr}  ` +
        `linvel=${m.totalLinvel.toFixed(2)}  angvel=${m.totalAngvel.toFixed(2)}  ` +
        `jointSep=${m.maxJointSeparation.toFixed(3)}  jitter=${jitter.toFixed(2)}  settle=${settleStr}`,
    );
  }

  function enterStand() {
    console.log('[lab] stand');
    if (!ragdoll.ok) {
      setHint(HINT_FAIL, '#ff6b6b');
      return;
    }
    stopMixer();
    restoreBindPose();
    ragdoll.enable({ vx: 0, vz: 0, floorY: 0 });
    ragdoll.captureStandPose();
    ragdoll.setPoseStrength(1);
    mode = 'stand';
    getUpT = 0;
    poseBlend = null;
    lastEnableOpts = { kind: 'stand' };
    markScenarioStart();
    updateStatusHint();
  }

  function fireTumble(opts?: { vx?: number; vz?: number }) {
    console.log('[lab] tumble');
    if (!ragdoll.ok) {
      setHint(HINT_FAIL, '#ff6b6b');
      return;
    }
    const vx = opts?.vx ?? 8;
    const vz = opts?.vz ?? 3;
    // stopMixer + restoreBindPose before enable — mid-idle bones + bind anchors explode.
    stopMixer();
    restoreBindPose();
    ragdoll.enable({ vx, vz, floorY: 0 });
    ragdoll.setPoseStrength(0);
    mode = 'tumble';
    getUpT = 0;
    poseBlend = null;
    lastEnableOpts = { kind: 'tumble', vx, vz };
    markScenarioStart();
    updateStatusHint();
  }

  function enterGetUp() {
    console.log('[lab] get up');
    if (!ragdoll.ok) {
      setHint(HINT_FAIL, '#ff6b6b');
      return;
    }
    stopMixer();
    if (!ragdoll.active) {
      restoreBindPose();
      ragdoll.enable({ vx: 0, vz: 0, floorY: 0 });
      ragdoll.captureStandPose();
    } else {
      // Keep limp body poses; capture stand targets from bind rotations.
      restoreBindPoseTargetsOnly();
    }
    ragdoll.setPoseStrength(0);
    mode = 'getup';
    getUpT = 0;
    poseBlend = null;
    updateStatusHint();
  }

  /** Capture stand targets from bind bone rotations without resetting body poses. */
  function restoreBindPoseTargetsOnly() {
    // Temporarily write bind rotations to bones, capture, then leave physics bodies as-is
    // (next step() will overwrite bones from bodies).
    const saved: { bone: THREE.Bone; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];
    for (const b of bindPose) {
      saved.push({
        bone: b.bone,
        q: b.bone.quaternion.clone(),
        p: b.bone.position.clone(),
      });
      b.bone.position.copy(b.position);
      b.bone.quaternion.copy(b.quaternion);
    }
    characterRoot.updateMatrixWorld(true);
    ragdoll.captureStandPose();
    for (const s of saved) {
      s.bone.position.copy(s.p);
      s.bone.quaternion.copy(s.q);
    }
    characterRoot.updateMatrixWorld(true);
  }

  function enterIdleClip() {
    console.log('[lab] idle clip');
    ragdoll.disable();
    disposeDebug();
    mode = 'idle';
    getUpT = 0;
    poseBlend = null;
    knockdownElapsed = 0;
    settleHold = 0;
    restartIdle();
    updateStatusHint();
  }

  function replayLast() {
    console.log('[lab] replay');
    if (!lastEnableOpts) {
      setHint('No scenario to replay yet', '#ffb347');
      return;
    }
    if (lastEnableOpts.kind === 'stand') enterStand();
    else fireTumble({ vx: lastEnableOpts.vx, vz: lastEnableOpts.vz });
  }

  function enterKnockdownRecover() {
    console.log('[lab] knockdown+recover');
    if (!ragdoll.ok) {
      setHint(HINT_FAIL, '#ff6b6b');
      return;
    }
    stopMixer();
    restoreBindPose();
    ragdoll.enable({ vx: 8, vz: 3, floorY: 0 });
    ragdoll.setPoseStrength(0);
    mode = 'knockdown';
    knockdownElapsed = 0;
    settleHold = 0;
    poseBlend = null;
    getUpT = 0;
    lastEnableOpts = { kind: 'tumble', vx: 8, vz: 3 };
    markScenarioStart();
    updateStatusHint();
  }

  function beginRecoverBlend() {
    const fromPose = captureBonePose(characterRoot);
    ragdoll.disable();
    disposeDebug();
    poseBlend = createPoseBlend({
      root: characterRoot,
      from: fromPose,
      to: bindPoseSamples,
      durationSec: RECOVER_BLEND_SEC,
    });
    mode = 'recover';
  }

  window.__ragdollLab = {
    fireTumble: () => fireTumble(),
    stand: enterStand,
    getUp: enterGetUp,
    idleClip: enterIdleClip,
    replay: replayLast,
    knockdownRecover: enterKnockdownRecover,
    ragdoll,
    getHipsY,
    listBones: () => listSkeletonBoneNames(characterRoot),
  };

  document.getElementById('standBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterStand();
  });
  document.getElementById('tumbleBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fireTumble();
  });
  document.getElementById('getUpBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterGetUp();
  });
  document.getElementById('idleBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterIdleClip();
  });
  document.getElementById('replayBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    replayLast();
  });
  document.getElementById('knockdownBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterKnockdownRecover();
  });
  const debugToggle = document.getElementById('debugToggle') as HTMLInputElement | null;
  debugToggle?.addEventListener('change', () => {
    debugEnabled = !!debugToggle.checked;
    if (!debugEnabled) disposeDebug();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      fireTumble();
    } else if (e.code === 'KeyS') {
      enterStand();
    } else if (e.code === 'KeyG') {
      enterGetUp();
    } else if (e.code === 'KeyI') {
      enterIdleClip();
    } else if (e.code === 'KeyR') {
      replayLast();
    } else if (e.code === 'KeyK') {
      enterKnockdownRecover();
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now() / 1000;
  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - last, 0.05);
    last = now;

    let effectiveDt = 0;
    if (paused) {
      if (stepOnce) {
        effectiveDt = ragdollTuning.fixedDt;
        stepOnce = false;
      }
    } else {
      effectiveDt = dt * timeScale;
    }

    if (mode === 'recover' && poseBlend) {
      if (effectiveDt > 0) {
        const done = poseBlend.update(effectiveDt);
        if (done) {
          poseBlend = null;
          mode = 'idle';
          restartIdle();
        }
      }
      updateStatusHint();
    } else if (mode === 'knockdown' && ragdoll.active) {
      if (effectiveDt > 0) {
        ragdoll.step(effectiveDt);
        knockdownElapsed += effectiveDt;
        const metrics = ragdoll.getMetrics();
        updateJitter(metrics.totalAngvel, effectiveDt);
        if (ragdoll.isSettled()) settleHold += effectiveDt;
        else settleHold = 0;
        if (settleHold >= SETTLE_HOLD_SEC || knockdownElapsed >= KNOCKDOWN_MAX_SEC) {
          beginRecoverBlend();
        }
      }
      syncDebug(ragdoll.getDebugBodies());
      updateStatusHint();
    } else if (ragdoll.active) {
      if (effectiveDt > 0) {
        if (mode === 'getup') {
          getUpT += effectiveDt;
          const s = Math.min(1, getUpT / GETUP_RAMP_SEC);
          ragdoll.setPoseStrength(s);
          if (s >= 1) mode = 'stand';
        }
        ragdoll.step(effectiveDt);
        const metrics = ragdoll.getMetrics();
        updateJitter(metrics.totalAngvel, effectiveDt);
      }
      syncDebug(ragdoll.getDebugBodies());
      updateStatusHint();
    } else {
      disposeDebug();
      if (effectiveDt > 0 && mixer) mixer.update(effectiveDt);
      if (mode === 'idle') updateStatusHint();
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  updateStatusHint();

  window.addEventListener('beforeunload', () => {
    disposeDebug();
    capsuleMat.dispose();
    jointMat.dispose();
    gui.destroy();
    ragdoll.dispose();
  });
}

main().catch((err) => {
  console.error(err);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = `Load failed: ${err instanceof Error ? err.message : String(err)}`;
});
