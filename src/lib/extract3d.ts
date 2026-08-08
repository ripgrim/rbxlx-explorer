/* eslint-disable @typescript-eslint/no-explicit-any */
import { TreeNode, RBXLXProperty } from "@/types/rbxlx";
import { brickColorToFloats } from "@/lib/brickColors";

export type PartShape = "block" | "ball" | "cylinder" | "wedge" | "corner-wedge";

export interface Part3D {
  id: string;
  name: string;
  class: string;
  shape: PartShape;
  size: [number, number, number];
  position: [number, number, number];
  rotation: number[]; // 9 floats, row-major 3x3
  color: [number, number, number]; // 0-1
  transparency: number; // 0-1 (Roblox style; 1 = invisible)
}

const PART_CLASSES = new Set([
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
  if ([x, y, z].some((n) => Number.isNaN(n))) return null;
  return [x, y, z];
}

function parseCFrame(raw: any): {
  position: [number, number, number];
  rotation: number[];
} | null {
  if (!raw) return null;
  const keys = [
    "X",
    "Y",
    "Z",
    "R00",
    "R01",
    "R02",
    "R10",
    "R11",
    "R12",
    "R20",
    "R21",
    "R22",
  ];
  const nums = keys.map((k) => Number(raw[k] ?? 0));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return {
    position: [nums[0], nums[1], nums[2]],
    rotation: nums.slice(3),
  };
}

function parseColor(props: RBXLXProperty[] | undefined): [number, number, number] {
  // Modern: Color3uint8 packed as 0xAARRGGBB.
  const c3u8 = findProp(props, "Color3uint8");
  if (c3u8) {
    const v = Number(c3u8.value ?? (c3u8.original as any)?.["@_value"]);
    if (!Number.isNaN(v) && v !== 0) {
      const r = ((v >>> 16) & 0xff) / 255;
      const g = ((v >>> 8) & 0xff) / 255;
      const b = (v & 0xff) / 255;
      return [r, g, b];
    }
  }
  // Legacy float Color3.
  const c3 = findProp(props, "Color");
  if (c3?.original) {
    const o = c3.original as any;
    if (o.R !== undefined || o.G !== undefined || o.B !== undefined) {
      const r = Number(o.R ?? 0);
      const g = Number(o.G ?? 0);
      const b = Number(o.B ?? 0);
      if (![r, g, b].some(Number.isNaN)) return [r, g, b];
    }
  }
  // Legacy BrickColor token.
  const bc = findProp(props, "BrickColor");
  if (bc) {
    const id = Number(bc.value);
    const col = brickColorToFloats(id);
    if (col) return col;
  }
  return [0.64, 0.64, 0.64];
}

function getShape(cls: string, props: RBXLXProperty[] | undefined): PartShape {
  if (cls === "WedgePart") return "wedge";
  if (cls === "CornerWedgePart") return "corner-wedge";
  // Part shape token: 0 = Ball, 1 = Block, 2 = Cylinder
  const shapeProp = findProp(props, "shape") || findProp(props, "Shape");
  if (shapeProp) {
    const v = Number(shapeProp.value);
    if (v === 0) return "ball";
    if (v === 2) return "cylinder";
  }
  return "block";
}

export function extractParts(tree: TreeNode[]): Part3D[] {
  const out: Part3D[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (PART_CLASSES.has(node.class)) {
        const sizeProp = findProp(node.properties, "size") || findProp(node.properties, "Size");
        const cframeProp = findProp(node.properties, "CFrame");
        const size = sizeProp ? parseVector3(sizeProp.original) : null;
        const cframe = cframeProp ? parseCFrame(cframeProp.original) : null;
        if (size && cframe) {
          const transparencyProp = findProp(node.properties, "Transparency");
          const transparency = transparencyProp
            ? Math.max(0, Math.min(1, Number(transparencyProp.value) || 0))
            : 0;
          out.push({
            id: node.id,
            name: node.name,
            class: node.class,
            shape: getShape(node.class, node.properties),
            size,
            position: cframe.position,
            rotation: cframe.rotation,
            color: parseColor(node.properties),
            transparency,
          });
        }
      }
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return out;
}
