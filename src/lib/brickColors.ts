// Full Roblox BrickColor palette (legacy BrickColor → RGB).
// Values are 0–255 ints, matching Roblox's documented BrickColor table.

export const BRICK_COLORS: Record<number, [number, number, number]> = {
  1: [242, 243, 243],   // White
  5: [215, 197, 154],   // Brick yellow
  9: [232, 186, 200],   // Light reddish violet
  11: [128, 187, 219],  // Pastel Blue
  18: [204, 142, 105],  // Nougat
  21: [196, 40, 28],    // Bright red
  23: [13, 105, 172],   // Bright blue
  24: [245, 205, 48],   // Bright yellow
  25: [98, 71, 50],     // Earth orange
  26: [27, 42, 53],     // Black
  28: [40, 127, 71],    // Dark green
  29: [161, 196, 140],  // Medium green
  37: [75, 151, 75],    // Bright green
  38: [160, 95, 53],    // Dark orange
  45: [180, 210, 228],  // Light blue
  101: [218, 134, 122], // Medium red
  102: [110, 153, 202], // Medium blue
  104: [107, 50, 124],  // Purple
  105: [226, 155, 64],  // Br. yellowish orange
  106: [218, 133, 65],  // Bright orange
  107: [0, 143, 156],   // Bright bluish green
  119: [164, 189, 71],  // Br. yellowish green
  125: [234, 184, 146], // Light orange
  135: [116, 134, 157], // Sand blue
  138: [149, 138, 115], // Sand yellow
  140: [32, 58, 86],    // Earth blue
  141: [39, 70, 45],    // Earth green
  151: [193, 202, 164], // Sand green
  153: [149, 121, 119], // Sand red
  168: [99, 95, 98],    // Gun metallic
  176: [151, 105, 91],  // Red flip/flop
  178: [180, 132, 85],  // Yellow flip/flop
  180: [215, 169, 75],  // Curry
  191: [232, 171, 45],  // Flame yellowish orange
  192: [105, 64, 40],   // Reddish brown
  194: [163, 162, 165], // Medium stone grey
  199: [99, 95, 98],    // Dark stone grey
  208: [229, 228, 223], // Light stone grey
  217: [124, 92, 70],   // Brown
  218: [150, 112, 159], // Medium lilac
  219: [107, 98, 155],  // Slime green
  226: [253, 234, 141], // Cool yellow
  232: [125, 187, 221], // Dove blue
  268: [52, 43, 117],   // Medium lilac (alt)
  301: [122, 119, 65],  // Olive
  302: [82, 124, 174],  // Light blue (alt)
  303: [22, 26, 33],    // Storm blue
  304: [161, 165, 162], // Lapis
  305: [82, 50, 156],   // Dark indigo
  306: [202, 90, 79],   // Sea green
  307: [161, 50, 33],   // Shamrock
  308: [97, 89, 95],    // Fossil
  309: [99, 47, 28],    // Wheat
  310: [69, 87, 102],   // Cloudy grey
  311: [241, 230, 134], // Lily white
  312: [156, 117, 105], // Seashell
  313: [49, 47, 38],    // Gold
  314: [50, 56, 49],    // Dirt brown
  315: [171, 191, 217], // Brick yellow (light)
  316: [25, 39, 56],    // Royal blue
  317: [69, 17, 9],     // Hot pink
  318: [186, 184, 144], // Bronze
  319: [191, 190, 156], // Flint
  320: [220, 120, 113], // Dark taupe
  321: [156, 21, 21],   // Burnt sienna
  322: [13, 105, 172],  // Institutional white
  323: [148, 190, 129], // Mid gray
  324: [136, 62, 62],   // Really black
  325: [86, 39, 24],    // Really white
  326: [220, 144, 149], // Deep blue
  327: [156, 24, 28],   // Quill grey
  328: [70, 73, 81],    // Buttermilk
  329: [113, 119, 109], // Flint
  330: [120, 92, 79],   // Smoky grey
  331: [161, 116, 67],  // Eggplant
  332: [105, 64, 40],   // Sand violet
  333: [180, 132, 85],  // Medium orange
  334: [253, 234, 141], // Sunrise
  335: [212, 156, 99],  // Tawny
  336: [243, 207, 155], // Rust
  337: [205, 84, 75],   // Cashmere
  338: [231, 240, 209], // Khaki
  339: [228, 173, 200], // Lily white
  340: [242, 243, 242], // Seashell
  341: [253, 219, 1],   // Burgundy
  342: [167, 169, 172], // Cork
  343: [223, 223, 222], // Burlap
  344: [105, 64, 40],   // Beige
  345: [125, 32, 39],   // Oyster
  346: [78, 24, 36],    // Pine cone
  347: [167, 49, 49],   // Fawn brown
  348: [222, 196, 167], // Hurricane grey
  349: [167, 30, 73],   // Cloudy grey
  350: [76, 0, 0],      // Linen
  1001: [248, 248, 248], // Institutional white
  1002: [205, 205, 205], // Mid grey
  1003: [17, 17, 17],   // Really black
  1004: [255, 0, 0],    // Really red
  1005: [255, 176, 0],  // Deep orange
  1006: [180, 128, 255], // Alder
  1007: [163, 75, 75],  // Dusty Rose
  1008: [193, 202, 164], // Olive
  1009: [255, 255, 0],  // New Yeller
  1010: [0, 0, 255],    // Really blue
  1011: [0, 32, 96],    // Navy blue
  1012: [33, 84, 185],  // Deep blue
  1013: [4, 175, 236],  // Cyan
  1014: [170, 85, 0],   // CGA brown
  1015: [170, 0, 170],  // Magenta
  1016: [255, 102, 204], // Pink
  1017: [255, 175, 0],  // Deep orange
  1018: [18, 238, 212], // Teal
  1019: [0, 255, 255],  // Toothpaste
  1020: [0, 255, 0],    // Lime green
  1021: [58, 125, 21],  // Camo
  1022: [127, 142, 100], // Grime
  1023: [140, 91, 159], // Lavender
  1024: [175, 221, 255], // Pastel light blue
  1025: [255, 201, 201], // Pastel orange
  1026: [177, 167, 255], // Pastel violet
  1027: [159, 243, 233], // Pastel blue-green
  1028: [204, 255, 204], // Pastel green
  1029: [255, 255, 204], // Pastel yellow
  1030: [255, 204, 153], // Pastel brown
  1031: [98, 37, 209],  // Royal purple
  1032: [255, 0, 191],  // Hot pink
};

export function brickColorToHex(id: number): string | null {
  const rgb = BRICK_COLORS[id];
  if (!rgb) return null;
  return rgb.map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function brickColorToFloats(id: number): [number, number, number] | null {
  const rgb = BRICK_COLORS[id];
  if (!rgb) return null;
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}
