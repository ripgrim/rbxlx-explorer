/* eslint-disable @typescript-eslint/no-explicit-any */
import { TreeNode, RBXLXProperty } from "@/types/rbxlx";
import { brickColorToHex } from "@/lib/brickColors";

export interface MapPartJson {
  Type: string;
  Position: [number, number, number];
  Rotation: [number, number, number];
  Size: [number, number, number];
  Color: string;
  Transparency: number;
  Shape: string;
  CantCollide: boolean;
}

// Classes the game knows how to render as map blocks.
const EXPORTED_CLASSES = new Set([
  "Part",
  "TrussPart",
  "WedgePart",
  "CornerWedgePart",
  "MeshPart",
  "SpawnLocation",
  "Seat",
  "VehicleSeat",
  "FlagStand",
  "SkateboardPlatform",
]);

function findProp(props: RBXLXProperty[] | undefined, name: string) {
  return props?.find((p) => p.name === name);
}

function parseVector3(raw: any): [number, number, number] | null {
  if (!raw) return null;
  const x = Number(raw.X ?? 0);
  const y = Number(raw.Y ?? 0);
  const z = Number(raw.Z ?? 0);
  if ([x, y, z].some(Number.isNaN)) return null;
  return [x, y, z];
}

function parseCFrame(
  raw: any
): { position: [number, number, number]; rot: number[] } | null {
  if (!raw) return null;
  const keys = [
    "X", "Y", "Z",
    "R00", "R01", "R02",
    "R10", "R11", "R12",
    "R20", "R21", "R22",
  ];
  const nums = keys.map((k) => Number(raw[k] ?? 0));
  if (nums.some(Number.isNaN)) return null;
  return {
    position: [nums[0], nums[1], nums[2]],
    rot: nums.slice(3), // R00..R22 row-major
  };
}

// Decompose row-major 3x3 rotation matrix into XYZ intrinsic Euler angles
// (radians) such that R = Rx(x) * Ry(y) * Rz(z). Bevy's Quat::from_euler(XYZ,...)
// reconstructs the same matrix.
function matrixToEulerXYZ(r: number[]): [number, number, number] {
  // r is [R00,R01,R02, R10,R11,R12, R20,R21,R22]
  const r00 = r[0], r01 = r[1], r02 = r[2];
  const r12 = r[5];
  const r20 = r[6], r21 = r[7], r22 = r[8];

  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  const y = Math.asin(clamp(r02));

  // Gimbal lock when |cos(y)| ~ 0.
  if (Math.abs(r02) < 0.99999) {
    const x = Math.atan2(-r12, r22);
    const z = Math.atan2(-r01, r00);
    return [x, y, z];
  }
  // Singular: pick z = 0 and resolve x.
  const x = Math.atan2(r21, r20 === 0 && r22 === 0 ? 1 : r22);
  return [x, y, 0];
}

function colorToHex(props: RBXLXProperty[] | undefined): string {
  // Modern parts: Color3uint8 packed as 0xAARRGGBB.
  const c3u8 = findProp(props, "Color3uint8");
  if (c3u8) {
    const v = Number(c3u8.value ?? (c3u8.original as any)?.["@_value"]);
    if (!Number.isNaN(v) && v !== 0) {
      const r = (v >>> 16) & 0xff;
      const g = (v >>> 8) & 0xff;
      const b = v & 0xff;
      return [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    }
  }
  // Legacy float Color3 with R/G/B sub-tags.
  const c3 = findProp(props, "Color");
  if (c3?.original) {
    const o = c3.original as any;
    if (o.R !== undefined || o.G !== undefined || o.B !== undefined) {
      const r = Math.round(Math.max(0, Math.min(1, Number(o.R ?? 0))) * 255);
      const g = Math.round(Math.max(0, Math.min(1, Number(o.G ?? 0))) * 255);
      const b = Math.round(Math.max(0, Math.min(1, Number(o.B ?? 0))) * 255);
      return [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    }
  }
  // Legacy BrickColor (token integer) — common in older studio-built maps.
  const bc = findProp(props, "BrickColor");
  if (bc) {
    const v = Number(bc.value);
    if (Number.isFinite(v)) {
      const hex = brickColorToHex(v);
      if (hex) return hex;
    }
  }
  return "a3a2a5"; // medium gray fallback
}

function shapeFor(cls: string, props: RBXLXProperty[] | undefined): string {
  if (cls === "WedgePart") return "Wedge";
  if (cls === "CornerWedgePart") return "Wedge";
  const s = findProp(props, "shape") || findProp(props, "Shape");
  if (s) {
    const v = Number(s.value);
    if (v === 0) return "Ball";
    if (v === 2) return "Cylinder";
  }
  return "Block";
}

function typeFor(cls: string): string {
  if (cls === "SpawnLocation") return "SpawnLocation";
  if (cls === "Seat" || cls === "VehicleSeat") return "Seat";
  return "Part";
}

function cantCollide(props: RBXLXProperty[] | undefined): boolean {
  const cc = findProp(props, "CanCollide");
  if (cc) {
    const v = cc.value;
    if (typeof v === "boolean") return !v;
    return String(v).toLowerCase() !== "true";
  }
  return false;
}

function transparency(props: RBXLXProperty[] | undefined): number {
  const t = findProp(props, "Transparency");
  if (!t) return 0;
  const n = Number(t.value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const RAD_TO_DEG = 180 / Math.PI;

function roundTo(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function convertToMapJson(tree: TreeNode[]): MapPartJson[] {
  const out: MapPartJson[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (EXPORTED_CLASSES.has(node.class)) {
        const sizeProp = findProp(node.properties, "size") || findProp(node.properties, "Size");
        const cframeProp = findProp(node.properties, "CFrame");
        const size = sizeProp ? parseVector3(sizeProp.original) : null;
        const cframe = cframeProp ? parseCFrame(cframeProp.original) : null;
        if (size && cframe) {
          const [ex, ey, ez] = matrixToEulerXYZ(cframe.rot);
          out.push({
            Type: typeFor(node.class),
            Position: cframe.position.map((n) => roundTo(n, 6)) as [number, number, number],
            Rotation: [
              roundTo(ex * RAD_TO_DEG),
              roundTo(ey * RAD_TO_DEG),
              roundTo(ez * RAD_TO_DEG),
            ],
            Size: size.map((n) => roundTo(n, 6)) as [number, number, number],
            Color: colorToHex(node.properties),
            Transparency: transparency(node.properties),
            Shape: shapeFor(node.class, node.properties),
            CantCollide: cantCollide(node.properties),
          });
        }
      }
      if (node.children) walk(node.children);
    }
  };

  walk(tree);
  return out;
}
