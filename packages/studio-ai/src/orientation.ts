/**
 * Left, right and which way things face: the one convention, said the same way to the AI, on the pictures
 * and to the person.
 *
 * A model document is written in the axes of a Bedrock geometry file: Y is up, the thing faces -Z, and
 * its OWN left is on +X (the vanilla left arm sits at +X). Studio's viewport, Blockbench and the game all
 * draw that file mirrored in X, which is why a part at +X shows on the picture's right when the thing
 * looks at you, as a left arm does. Face names are compass points for something that faces north: west is
 * on its left, east on its right. So a face's name says where it points in the thing's own terms, and
 * `west` points towards +X, not -X. No imports.
 */
export const OWN_LEFT_X = 1

/** Where each face of an unturned box points, in the thing's own terms. The words a person reads. */
export const FACE_WORDS = { north: "正面", south: "背面", west: "它的左侧", east: "它的右侧", up: "上面", down: "下面" } as const

/** The two sides as the pictures name them. */
export const SIDE_WORDS = { left: FACE_WORDS.west, right: FACE_WORDS.east } as const

/**
 * The side face of an unturned box that points away from the centre line (x = 0), from the X of the box's
 * centre in the document: `west` on the thing's own left, `east` on its right. Null on the line itself,
 * where neither is the outer one.
 */
export function outerFace(centreX: number): "west" | "east" | null {
  if (centreX === 0) return null
  return centreX * OWN_LEFT_X > 0 ? "west" : "east"
}

/** The side face that points at the centre line: the other one. */
export function innerFace(centreX: number): "west" | "east" | null {
  const outer = outerFace(centreX)
  if (!outer) return null
  return outer === "west" ? "east" : "west"
}

/** The exact sentences every maker is given, whichever way it writes the model. */
export const ORIENTATION_GUIDE =
  `左右和朝向只有这一种说法，文档、脚本和图上的字都按它：` +
  `这样东西面朝 -Z，north 面就是它的正面。左右说的是它自己的左右（它面朝前方时它自己的左手边和右手边），不是看图的人的左右：它自己的左边在 +X 一侧，右边在 -X 一侧，和原版基岩版模型一样（原版的左臂就在 +X）。` +
  `六个面的名字按它自己的方向读：north 朝正前，south 朝正后，west 朝它自己的左边（+X 方向），east 朝它自己的右边（-X 方向），up 朝上，down 朝下。` +
  `所以左侧部件（方块中心 x 大于 0）的外侧——背向身体中线 x=0 的那一面——是 west，贴着身体的内侧是 east；右侧部件（方块中心 x 小于 0）反过来，外侧是 east，内侧是 west。骨骼自己带着 rotation 时，面跟着骨骼一起转，要按转完以后的朝向算。` +
  // Round 15 (10-07): an outside maker's first walk swung the planted legs forward, a sign the guide had never stated; measured with `posedCorners`.
  // 10-13: the y and z sentences had the sides the wrong way round (never measured, only x was); each sentence is now pinned against posedCorners in a test.
  `转动的正负也只有这一种（骨骼的 rotation 和动作轨道里的 rotation 一样，单位是度）：绕 x 轴转正的角度，轴点下面的部分往后（+Z）摆、轴点前面的部分往下低——所以往下垂的肢体 x 为负是往前伸，为正是往后摆；绕 y 轴转正的角度，是朝它自己的右边（-X）转（前面的部分转向它的右手边）；绕 z 轴转正的角度，轴点下面的部分往它自己的右边（-X）摆、上面的部分往左边（+X）倒——所以往左边（+X）伸出去的部件（左翅膀、左臂平举）z 为正是往下压、为负是往上抬，往右边（-X）伸出去的部件反过来，z 为正是往上抬。` +
  `做完以后在图上核对：左侧部件外侧画的东西，应该出现在写着「${SIDE_WORDS.left}」的那一格，而不在「${SIDE_WORDS.right}」那一格；右侧部件反过来。`
