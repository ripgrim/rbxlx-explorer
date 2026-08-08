"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TreeNode } from "@/types/rbxlx";
import { extractParts, Part3D } from "@/lib/extract3d";
import { SpawnPoint, DEFAULT_SPAWN_SIZE } from "@/lib/projects";
import { AlertTriangle, Box, RefreshCw, MapPin, X } from "lucide-react";

interface Viewer3DProps {
  tree: TreeNode[];
  selectedNodeId: string | null;
  onSelectPart?: (id: string) => void;
  spawns: SpawnPoint[];
  onAddSpawn: (pos: [number, number, number]) => void;
  onClearSpawns: () => void;
  onUpdateSpawn: (
    id: string,
    update: { position?: [number, number, number]; rotation?: [number, number, number] }
  ) => void;
  onRemoveSpawn: (id: string) => void;
}

function disposeOutline(group: THREE.Group | null) {
  if (!group) return;
  group.traverse((obj) => {
    const m = obj as THREE.Mesh | THREE.LineSegments;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else mat?.dispose?.();
  });
}

function createOutlineForMesh(mesh: THREE.Mesh, color: number, scale = 1.06): THREE.Group {
  const group = new THREE.Group();

  const haloMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(mesh.geometry, haloMat);
  halo.scale.setScalar(scale);
  group.add(halo);

  const edges = new THREE.EdgesGeometry(mesh.geometry);
  const lineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(edges, lineMat);
  lines.renderOrder = 999;
  group.add(lines);

  group.position.copy(mesh.position);
  group.quaternion.copy(mesh.quaternion);
  group.scale.copy(mesh.scale);
  return group;
}

function createOutlineForMany(
  meshes: THREE.Mesh[],
  color: number,
  scale = 1.06
): THREE.Group {
  const parent = new THREE.Group();
  for (const m of meshes) parent.add(createOutlineForMesh(m, color, scale));
  return parent;
}

const GROUP_CLASSES = new Set(["Model", "Folder"]);

function indexTree(tree: TreeNode[]): Map<string, { node: TreeNode; parents: TreeNode[] }> {
  const out = new Map<string, { node: TreeNode; parents: TreeNode[] }>();
  const walk = (nodes: TreeNode[], parents: TreeNode[]) => {
    for (const n of nodes) {
      out.set(n.id, { node: n, parents });
      if (n.children) walk(n.children, [...parents, n]);
    }
  };
  walk(tree, []);
  return out;
}

function resolveOutermostGroup(
  index: Map<string, { node: TreeNode; parents: TreeNode[] }>,
  leafId: string
): TreeNode {
  const entry = index.get(leafId);
  if (!entry) return { id: leafId, name: leafId, class: "" };
  for (const ancestor of entry.parents) {
    if (GROUP_CLASSES.has(ancestor.class)) return ancestor;
  }
  return entry.node;
}

function collectDescendantIds(node: TreeNode): string[] {
  const out: string[] = [node.id];
  if (node.children) {
    for (const c of node.children) out.push(...collectDescendantIds(c));
  }
  return out;
}

function buildGeometry(part: Part3D): THREE.BufferGeometry {
  const [sx, sy, sz] = part.size;
  switch (part.shape) {
    case "ball": {
      const r = Math.min(sx, sy, sz) / 2;
      return new THREE.SphereGeometry(r, 16, 12);
    }
    case "cylinder": {
      // Roblox cylinders extend along their local X axis.
      const radius = Math.min(sy, sz) / 2;
      const geo = new THREE.CylinderGeometry(radius, radius, sx, 24);
      geo.rotateZ(Math.PI / 2);
      return geo;
    }
    case "wedge": {
      // Right-triangle prism: ramps up along +Z, with the high edge at +Y, low at -Y.
      const hx = sx / 2,
        hy = sy / 2,
        hz = sz / 2;
      const verts = new Float32Array([
        // bottom face
        -hx, -hy, -hz,
         hx, -hy, -hz,
         hx, -hy,  hz,
        -hx, -hy,  hz,
        // top edge (at +Y, -Z side — the high edge of the ramp)
        -hx,  hy, -hz,
         hx,  hy, -hz,
      ]);
      const idx = [
        // bottom
        0, 2, 1, 0, 3, 2,
        // back (vertical, at -Z)
        0, 1, 5, 0, 5, 4,
        // ramp (sloped face)
        2, 3, 4, 2, 4, 5,
        // sides (two triangles)
        1, 2, 5,
        0, 4, 3,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }
    case "corner-wedge": {
      const hx = sx / 2,
        hy = sy / 2,
        hz = sz / 2;
      const verts = new Float32Array([
        -hx, -hy, -hz,
         hx, -hy, -hz,
         hx, -hy,  hz,
        -hx, -hy,  hz,
         hx,  hy, -hz,
      ]);
      const idx = [
        0, 2, 1, 0, 3, 2,
        0, 1, 4,
        1, 2, 4,
        2, 3, 4,
        0, 4, 3,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }
    default:
      return new THREE.BoxGeometry(sx, sy, sz);
  }
}

export default function Viewer3D({
  tree,
  selectedNodeId,
  onSelectPart,
  spawns,
  onAddSpawn,
  onClearSpawns,
  onUpdateSpawn,
  onRemoveSpawn,
}: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const partsGroupRef = useRef<THREE.Group | null>(null);
  const meshByIdRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const highlightRef = useRef<THREE.Group | null>(null);
  const hoverOutlineRef = useRef<THREE.Group | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const nodeIndexRef = useRef<Map<string, { node: TreeNode; parents: TreeNode[] }>>(
    new Map()
  );
  const keysRef = useRef<Set<string>>(new Set());
  const pointerInsideRef = useRef<boolean>(false);
  const groupSelectRef = useRef<boolean>(true);
  const sceneRadiusRef = useRef<number>(50);
  const yawRef = useRef<number>(0);
  const pitchRef = useRef<number>(0);
  const syncYawPitchRef = useRef<() => void>(() => {});
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const spawnsGroupRef = useRef<THREE.Group | null>(null);
  const spawnMeshByIdRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const placementModeRef = useRef<boolean>(false);
  const onAddSpawnRef = useRef(onAddSpawn);
  const onUpdateSpawnRef = useRef(onUpdateSpawn);
  const onRemoveSpawnRef = useRef(onRemoveSpawn);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const attachedSpawnIdRef = useRef<string | null>(null);
  const gizmoDraggingRef = useRef<boolean>(false);

  const [partCount, setPartCount] = useState(0);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [groupSelect, setGroupSelect] = useState(true);
  const [placementMode, setPlacementMode] = useState(false);
  const [attachedSpawnId, setAttachedSpawnId] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate">("translate");

  useEffect(() => {
    groupSelectRef.current = groupSelect;
  }, [groupSelect]);
  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);
  useEffect(() => {
    onAddSpawnRef.current = onAddSpawn;
  }, [onAddSpawn]);
  useEffect(() => {
    onUpdateSpawnRef.current = onUpdateSpawn;
  }, [onUpdateSpawn]);
  useEffect(() => {
    onRemoveSpawnRef.current = onRemoveSpawn;
  }, [onRemoveSpawn]);
  useEffect(() => {
    attachedSpawnIdRef.current = attachedSpawnId;
  }, [attachedSpawnId]);
  useEffect(() => {
    if (transformControlsRef.current) transformControlsRef.current.setMode(gizmoMode);
  }, [gizmoMode]);

  // Init scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xaecbe0, 1500, 8000);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      20000
    );
    camera.position.set(80, 80, 80);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    container.appendChild(renderer.domElement);

    // Free-fly camera: we drive yaw/pitch directly and use camera.rotation
    // (YXZ order) so dragging always rotates the view, never orbits a target.
    camera.rotation.order = "YXZ";
    camera.lookAt(0, 0, 0);

    // Sky dome — Roblox-style atmospheric scattering.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 4;
    skyUniforms.rayleigh.value = 1.6;
    skyUniforms.mieCoefficient.value = 0.005;
    skyUniforms.mieDirectionalG.value = 0.8;
    const sunPos = new THREE.Vector3();
    // Elevation ~35°, azimuth ~135° — Roblox's default "soft afternoon" feel.
    const phi = THREE.MathUtils.degToRad(90 - 35);
    const theta = THREE.MathUtils.degToRad(135);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyUniforms.sunPosition.value.copy(sunPos);
    scene.add(sky);

    // Hemisphere fill — sky/ground bounce light.
    const hemi = new THREE.HemisphereLight(0xbcd4ec, 0x5a4a3a, 0.55);
    scene.add(hemi);

    // Directional sun with shadows.
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
    sun.position.copy(sunPos).multiplyScalar(500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const SH = 400;
    sun.shadow.camera.left = -SH;
    sun.shadow.camera.right = SH;
    sun.shadow.camera.top = SH;
    sun.shadow.camera.bottom = -SH;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 2000;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
    scene.add(sun);
    scene.add(sun.target);

    // Ground plane that catches shadows (subtle, blends with the sky color).
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid + axes for orientation (drawn above the shadow plane).
    const grid = new THREE.GridHelper(1000, 100, 0x6a7d8a, 0x4a5a64);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);
    const axes = new THREE.AxesHelper(20);
    scene.add(axes);

    const partsGroup = new THREE.Group();
    scene.add(partsGroup);

    const spawnsGroup = new THREE.Group();
    scene.add(spawnsGroup);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    partsGroupRef.current = partsGroup;
    spawnsGroupRef.current = spawnsGroup;
    groundMeshRef.current = ground;

    // XYZ transform gizmo for moving / rotating attached spawns.
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setSize(0.9);
    // r169+ requires adding the visual helper rather than the controls object.
    const gizmoHelper =
      (transformControls as unknown as { getHelper?: () => THREE.Object3D }).getHelper?.() ??
      (transformControls as unknown as THREE.Object3D);
    scene.add(gizmoHelper);
    transformControlsRef.current = transformControls;

    transformControls.addEventListener("dragging-changed", (e) => {
      const dragging = Boolean(e.value);
      gizmoDraggingRef.current = dragging;
      if (!dragging) {
        // Commit on drag-end so we don't thrash React state per frame.
        const mesh = transformControls.object as THREE.Mesh | null;
        const id = mesh?.userData.spawnId as string | undefined;
        if (mesh && id && onUpdateSpawnRef.current) {
          const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, "XYZ");
          onUpdateSpawnRef.current(id, {
            position: [mesh.position.x, mesh.position.y, mesh.position.z],
            rotation: [
              THREE.MathUtils.radToDeg(euler.x),
              THREE.MathUtils.radToDeg(euler.y),
              THREE.MathUtils.radToDeg(euler.z),
            ],
          });
        }
      }
    });

    const detachGizmo = () => {
      transformControls.detach();
      attachedSpawnIdRef.current = null;
      setAttachedSpawnId(null);
    };

    let raf = 0;
    let lastT = performance.now();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const upWorld = new THREE.Vector3(0, 1, 0);
    const move = new THREE.Vector3();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;

      const keys = keysRef.current;
      if (pointerInsideRef.current && keys.size > 0) {
        // Free-fly: W/S follow the full camera-facing direction (pitch included),
        // A/D strafe along the camera-local horizontal, Q/E move world-up/down.
        camera.getWorldDirection(fwd).normalize();
        right.crossVectors(fwd, upWorld);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        else right.normalize();

        const baseSpeed = Math.max(20, sceneRadiusRef.current * 0.6);
        const speed = (keys.has("shift") ? 3 : 1) * baseSpeed * dt;

        move.set(0, 0, 0);
        if (keys.has("w")) move.addScaledVector(fwd, speed);
        if (keys.has("s")) move.addScaledVector(fwd, -speed);
        if (keys.has("d")) move.addScaledVector(right, speed);
        if (keys.has("a")) move.addScaledVector(right, -speed);
        if (keys.has("e") || keys.has(" ")) move.y += speed;
        if (keys.has("q") || keys.has("control")) move.y -= speed;

        if (move.lengthSq() > 0) camera.position.add(move);
      }

      renderer.render(scene, camera);
    };
    animate();

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // Gizmo shortcuts work as long as a spawn is attached, regardless of
      // pointer-over state. Other keys still require focus on the canvas.
      if (k === "escape" && attachedSpawnIdRef.current) {
        detachGizmo();
        e.preventDefault();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && attachedSpawnIdRef.current) {
        const id = attachedSpawnIdRef.current;
        detachGizmo();
        onRemoveSpawnRef.current?.(id);
        e.preventDefault();
        return;
      }
      if (!pointerInsideRef.current) return;
      const tracked = ["w", "a", "s", "d", "q", "e", "shift", "control", " "];
      if (tracked.includes(k)) {
        keysRef.current.add(k);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    const clearKeys = () => keysRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);

    const resize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Raycast on click for picking + on hover for outline
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const pick = (ev: MouseEvent): THREE.Mesh | null => {
      if (!partsGroupRef.current) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(partsGroupRef.current.children, false);
      return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
    };

    // Placement raycast: returns the first world-space hit point against parts
    // or the ground plane, whichever is closer.
    const pickPlacement = (ev: MouseEvent): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const targets: THREE.Object3D[] = [];
      if (partsGroupRef.current) targets.push(...partsGroupRef.current.children);
      if (groundMeshRef.current) targets.push(groundMeshRef.current);
      const hits = raycaster.intersectObjects(targets, false);
      return hits.length > 0 ? hits[0].point.clone() : null;
    };

    // Returns the target id for selection plus all meshes that should be outlined
    // (the picked part itself, or every part under its outermost Model/Folder).
    const resolvePickTarget = (
      mesh: THREE.Mesh
    ): { id: string; name: string; meshes: THREE.Mesh[] } => {
      const partId = mesh.userData.partId as string;
      const partName = (mesh.userData.partName as string) ?? partId;
      if (!groupSelectRef.current) {
        return { id: partId, name: partName, meshes: [mesh] };
      }
      const group = resolveOutermostGroup(nodeIndexRef.current, partId);
      if (group.id === partId) {
        return { id: partId, name: partName, meshes: [mesh] };
      }
      const ids = collectDescendantIds(group);
      const meshes: THREE.Mesh[] = [];
      for (const id of ids) {
        const m = meshByIdRef.current.get(id);
        if (m) meshes.push(m);
      }
      return {
        id: group.id,
        name: group.name,
        meshes: meshes.length > 0 ? meshes : [mesh],
      };
    };

    const setHoverOutline = (mesh: THREE.Mesh | null) => {
      const target = mesh ? resolvePickTarget(mesh) : null;
      const nextId = target?.id ?? null;
      if (hoveredIdRef.current === nextId) return;
      hoveredIdRef.current = nextId;

      if (hoverOutlineRef.current) {
        scene.remove(hoverOutlineRef.current);
        disposeOutline(hoverOutlineRef.current);
        hoverOutlineRef.current = null;
      }

      if (target) {
        const outline = createOutlineForMany(target.meshes, 0xffb020, 1.06);
        scene.add(outline);
        hoverOutlineRef.current = outline;
        setHoveredName(target.name);
      } else {
        setHoveredName(null);
      }
    };

    // Read yaw/pitch directly off the camera's YXZ rotation.
    const syncYawPitch = () => {
      yawRef.current = camera.rotation.y;
      pitchRef.current = camera.rotation.x;
    };
    const applyLook = () => {
      camera.rotation.y = yawRef.current;
      camera.rotation.x = pitchRef.current;
      camera.rotation.z = 0;
    };
    syncYawPitch();
    syncYawPitchRef.current = syncYawPitch;

    let dragging = false;
    let dragMoved = 0;
    let downEv: MouseEvent | null = null;
    const PITCH_LIMIT = Math.PI / 2 - 0.01;
    const SENS = 0.0035;

    const onPointerDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      // If the gizmo is hovered or already dragging, let it own the event.
      const tc = transformControlsRef.current;
      if (tc && (tc.dragging || (tc as unknown as { axis: string | null }).axis)) {
        return;
      }
      dragging = true;
      dragMoved = 0;
      downEv = ev;
      renderer.domElement.requestPointerLock?.();
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      // Treat as a click if the mouse barely moved.
      if (dragMoved < 6 && downEv) {
        if (placementModeRef.current) {
          const point = pickPlacement(downEv);
          if (point) {
            // Sit the spawn block on top of the picked surface.
            const y = point.y + DEFAULT_SPAWN_SIZE[1] / 2;
            onAddSpawnRef.current([point.x, y, point.z]);
          }
        } else {
          // Spawn click → attach gizmo. Part click → detach gizmo + select.
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((downEv.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((downEv.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);

          const spawnMeshes = Array.from(spawnMeshByIdRef.current.values());
          const spawnHits = raycaster.intersectObjects(spawnMeshes, false);
          if (spawnHits.length > 0) {
            const mesh = spawnHits[0].object as THREE.Mesh;
            const id = mesh.userData.spawnId as string;
            transformControlsRef.current?.attach(mesh);
            attachedSpawnIdRef.current = id;
            setAttachedSpawnId(id);
            // Mirror the selection in the tree so the sidebar highlights it too.
            onSelectPart?.(id);
          } else if (onSelectPart) {
            const mesh = pick(downEv);
            if (mesh) {
              const target = resolvePickTarget(mesh);
              onSelectPart(target.id);
              detachGizmo();
            } else {
              detachGizmo();
            }
          }
        }
      }
      downEv = null;
    };
    const onMove = (ev: MouseEvent) => {
      if (gizmoDraggingRef.current) {
        // Gizmo owns the pointer for the duration of its drag.
        return;
      }
      if (dragging) {
        dragMoved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
        yawRef.current -= ev.movementX * SENS;
        pitchRef.current = Math.max(
          -PITCH_LIMIT,
          Math.min(PITCH_LIMIT, pitchRef.current - ev.movementY * SENS)
        );
        applyLook();
        // Suppress hover updates while looking around.
        return;
      }
      setHoverOutline(pick(ev));
    };
    const onLeave = () => {
      setHoverOutline(null);
      pointerInsideRef.current = false;
      keysRef.current.clear();
    };
    const onEnter = () => {
      pointerInsideRef.current = true;
    };
    const onPointerLockChange = () => {
      if (document.pointerLockElement !== renderer.domElement) {
        dragging = false;
      }
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const baseStep = Math.max(2, sceneRadiusRef.current * 0.05);
      const step = -Math.sign(ev.deltaY) * baseStep;
      camera.position.addScaledVector(dir, step);
    };

    renderer.domElement.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mouseup", onPointerUp);
    renderer.domElement.addEventListener("mousemove", onMove);
    renderer.domElement.addEventListener("mouseleave", onLeave);
    renderer.domElement.addEventListener("mouseenter", onEnter);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("mouseup", onPointerUp);
      renderer.domElement.removeEventListener("mousemove", onMove);
      renderer.domElement.removeEventListener("mouseleave", onLeave);
      renderer.domElement.removeEventListener("mouseenter", onEnter);
      renderer.domElement.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      if (hoverOutlineRef.current) {
        scene.remove(hoverOutlineRef.current);
        disposeOutline(hoverOutlineRef.current);
        hoverOutlineRef.current = null;
      }
      transformControls.detach();
      transformControls.dispose();
      scene.remove(gizmoHelper);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      meshByIdRef.current.clear();
      spawnMeshByIdRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild geometry whenever the tree changes
  useEffect(() => {
    const partsGroup = partsGroupRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!partsGroup || !scene || !camera) return;

    if (hoverOutlineRef.current) {
      scene.remove(hoverOutlineRef.current);
      disposeOutline(hoverOutlineRef.current);
      hoverOutlineRef.current = null;
      hoveredIdRef.current = null;
      setHoveredName(null);
    }
    if (highlightRef.current) {
      scene.remove(highlightRef.current);
      disposeOutline(highlightRef.current);
      highlightRef.current = null;
    }

    // Clear previous
    for (const child of [...partsGroup.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      partsGroup.remove(child);
    }
    meshByIdRef.current.clear();

    nodeIndexRef.current = indexTree(tree);

    const parts = extractParts(tree);
    setPartCount(parts.length);

    const bbox = new THREE.Box3();
    const tmp = new THREE.Vector3();

    for (const part of parts) {
      const geo = buildGeometry(part);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color[0], part.color[1], part.color[2]),
        roughness: 0.85,
        metalness: 0.0,
        transparent: part.transparency > 0,
        opacity: 1 - part.transparency,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const m = new THREE.Matrix4();
      // Roblox CFrame rotation is row-major.
      m.set(
        part.rotation[0], part.rotation[1], part.rotation[2], part.position[0],
        part.rotation[3], part.rotation[4], part.rotation[5], part.position[1],
        part.rotation[6], part.rotation[7], part.rotation[8], part.position[2],
        0, 0, 0, 1
      );
      mesh.position.setFromMatrixPosition(m);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.userData.partId = part.id;
      mesh.userData.partName = part.name;
      partsGroup.add(mesh);
      meshByIdRef.current.set(part.id, mesh);

      tmp.set(...part.position);
      bbox.expandByPoint(tmp);
    }

    // Frame the scene if we have parts
    if (!bbox.isEmpty()) {
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 10);
      sceneRadiusRef.current = maxDim;
      camera.position.set(
        center.x + maxDim * 1.1,
        center.y + maxDim * 0.9,
        center.z + maxDim * 1.1
      );
      camera.lookAt(center);
      camera.near = Math.max(0.1, maxDim / 1000);
      camera.far = Math.max(2000, maxDim * 20);
      camera.updateProjectionMatrix();
      syncYawPitchRef.current();
    }
  }, [tree]);

  // Render the spawn-point markers.
  useEffect(() => {
    const group = spawnsGroupRef.current;
    if (!group) return;

    // Detach the gizmo before disposing the mesh it's pointing at — we'll
    // re-attach to the freshly built mesh below if the same spawn still exists.
    if (transformControlsRef.current?.object) transformControlsRef.current.detach();

    for (const child of [...group.children]) {
      group.remove(child);
      const m = child as THREE.Mesh | THREE.LineSegments;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose?.();
    }
    spawnMeshByIdRef.current.clear();

    for (const spawn of spawns) {
      const [sx, sy, sz] = spawn.size;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
          color: 0x2bd66b,
          emissive: 0x103a23,
          transparent: true,
          opacity: 0.55,
          roughness: 0.5,
        })
      );
      block.position.set(...spawn.position);
      block.rotation.set(
        THREE.MathUtils.degToRad(spawn.rotation[0]),
        THREE.MathUtils.degToRad(spawn.rotation[1]),
        THREE.MathUtils.degToRad(spawn.rotation[2])
      );
      block.userData.spawnId = spawn.id;

      const edges = new THREE.EdgesGeometry(block.geometry);
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x6cff9c, depthTest: false })
      );
      outline.renderOrder = 998;
      outline.position.copy(block.position);
      outline.quaternion.copy(block.quaternion);

      const beaconGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(spawn.position[0], spawn.position[1], spawn.position[2]),
        new THREE.Vector3(spawn.position[0], spawn.position[1] + 25, spawn.position[2]),
      ]);
      const beacon = new THREE.Line(
        beaconGeo,
        new THREE.LineBasicMaterial({ color: 0x6cff9c, transparent: true, opacity: 0.7 })
      );

      group.add(block);
      group.add(outline);
      group.add(beacon);
      spawnMeshByIdRef.current.set(spawn.id, block);
    }

    // Re-attach the gizmo to the newly created mesh for the same spawn id.
    const attachedId = attachedSpawnIdRef.current;
    if (attachedId) {
      const mesh = spawnMeshByIdRef.current.get(attachedId);
      if (mesh) transformControlsRef.current?.attach(mesh);
      else {
        attachedSpawnIdRef.current = null;
        setAttachedSpawnId(null);
      }
    }
  }, [spawns]);

  // Sync the gizmo with whatever's selected in the tree: a spawn id attaches
  // the gizmo to that spawn; a part id (or no selection) detaches.
  useEffect(() => {
    const tc = transformControlsRef.current;
    if (!tc) return;
    if (selectedNodeId) {
      const mesh = spawnMeshByIdRef.current.get(selectedNodeId);
      if (mesh) {
        tc.attach(mesh);
        attachedSpawnIdRef.current = selectedNodeId;
        setAttachedSpawnId(selectedNodeId);
        return;
      }
    }
    if (attachedSpawnIdRef.current) {
      tc.detach();
      attachedSpawnIdRef.current = null;
      setAttachedSpawnId(null);
    }
  }, [selectedNodeId]);

  // Highlight selected part
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (highlightRef.current) {
      scene.remove(highlightRef.current);
      disposeOutline(highlightRef.current);
      highlightRef.current = null;
    }
    if (!selectedNodeId) return;
    const meshes: THREE.Mesh[] = [];
    const direct = meshByIdRef.current.get(selectedNodeId);
    if (direct) {
      meshes.push(direct);
    } else {
      const entry = nodeIndexRef.current.get(selectedNodeId);
      if (entry) {
        for (const id of collectDescendantIds(entry.node)) {
          const m = meshByIdRef.current.get(id);
          if (m) meshes.push(m);
        }
      }
    }
    if (meshes.length === 0) return;
    const outline = createOutlineForMany(meshes, 0x33ccff, 1.08);
    scene.add(outline);
    highlightRef.current = outline;
  }, [selectedNodeId]);

  const frameAll = () => {
    const partsGroup = partsGroupRef.current;
    const camera = cameraRef.current;
    if (!partsGroup || !camera) return;
    const bbox = new THREE.Box3().setFromObject(partsGroup);
    if (bbox.isEmpty()) return;
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 10);
    camera.position.set(
      center.x + maxDim * 1.1,
      center.y + maxDim * 0.9,
      center.z + maxDim * 1.1
    );
    camera.lookAt(center);
    syncYawPitchRef.current();
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] relative">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center">
          <Box className="h-4 w-4 mr-2 text-blue-500" />
          <span>3D Preview</span>
          <span className="ml-2 text-xs text-gray-500">{partCount} parts</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPlacementMode((v) => !v)}
            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
              placementMode
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-[#252525] text-gray-300 hover:bg-[#303030]"
            }`}
            title="Click in the scene to place a spawn point"
          >
            <MapPin className="h-3 w-3" />
            {placementMode ? "Placing…" : "Place spawn"}
          </button>
          {attachedSpawnId && (
            <div className="flex items-center gap-0.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-0.5">
              <button
                onClick={() => setGizmoMode("translate")}
                className={`text-xs px-2 py-0.5 rounded ${
                  gizmoMode === "translate"
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-[#2a2a2a]"
                }`}
                title="Move (translate)"
              >
                Move
              </button>
              <button
                onClick={() => setGizmoMode("rotate")}
                className={`text-xs px-2 py-0.5 rounded ${
                  gizmoMode === "rotate"
                    ? "bg-emerald-600 text-white"
                    : "text-gray-300 hover:bg-[#2a2a2a]"
                }`}
                title="Rotate"
              >
                Rotate
              </button>
            </div>
          )}
          {spawns.length > 0 && (
            <button
              onClick={onClearSpawns}
              className="text-xs px-2 py-1 rounded bg-[#252525] text-gray-300 hover:bg-red-950/60 hover:text-red-200 flex items-center gap-1"
              title="Remove all spawn points"
            >
              <X className="h-3 w-3" />
              Clear ({spawns.length})
            </button>
          )}
          <button
            onClick={() => setGroupSelect((v) => !v)}
            className={`text-xs px-2 py-1 rounded flex items-center ${
              groupSelect
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-[#252525] text-gray-300 hover:bg-[#303030]"
            }`}
            title="When on, clicking a part selects its outermost Model/Folder"
          >
            Select group
          </button>
          <button
            onClick={frameAll}
            className="text-xs px-2 py-1 rounded bg-[#252525] hover:bg-[#303030] flex items-center"
            title="Frame all parts"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Recenter
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden ${
          placementMode ? "cursor-crosshair" : hoveredName ? "cursor-pointer" : ""
        }`}
      >
        {placementMode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-emerald-900/90 border border-emerald-500/60 text-emerald-100 text-xs rounded px-3 py-1.5 flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" />
            Click a surface to drop a spawn ({DEFAULT_SPAWN_SIZE.join(" × ")})
          </div>
        )}
        {hoveredName && (
          <div className="absolute bottom-2 left-2 z-10 bg-[#0f0f0f]/90 border border-orange-500/50 text-orange-200 text-xs rounded px-2 py-1 pointer-events-none">
            {hoveredName}
          </div>
        )}
        <div className="absolute bottom-2 right-2 z-10 bg-[#0f0f0f]/70 text-gray-400 text-[10px] rounded px-2 py-1 pointer-events-none font-mono">
          {attachedSpawnId
            ? "drag gizmo to edit · Esc detach · Del remove · WASD move"
            : "WASD move · Q/E down/up · Shift sprint · drag to look · click spawn to edit"}
        </div>
        {showDisclaimer && (
          <div className="absolute top-2 left-2 right-2 z-10 max-w-md bg-yellow-950/90 border border-yellow-700/60 text-yellow-100 text-xs rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              Primitive preview only. Meshes, decals, textures, unions, terrain,
              and most visual effects are not rendered. Geometry approximates
              parts as basic shapes.
            </div>
            <button
              onClick={() => setShowDisclaimer(false)}
              className="text-yellow-300 hover:text-yellow-100 px-1"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {partCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
            No renderable parts found in this file
          </div>
        )}
      </div>
    </div>
  );
}
