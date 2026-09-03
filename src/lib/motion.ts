"use client";

/**
 * 弹簧动效 token —— 把苹果《Designing Fluid Interfaces》的
 * damping + response 两参映射到 Motion 的 bounce + duration。
 *
 * 用法约定:
 * - 默认一律 SPRING_UI(临界阻尼,无回弹):移动 / 淡入 / 大部分 UI 转场
 * - 只有「手势本身携带动量」时才用 SPRING_BOUNCE(拖拽释放 / flick / 接住)
 * - 抽屉、下拉、弹出层用 SPRING_SNAPPY(更快抵达)
 *
 * Motion 弹簧默认从当前 presentation 值出发,天然可打断、可中途反向。
 */

import type * as React from "react";
import type { HTMLMotionProps, Transition } from "motion/react";

/**
 * 用 motion.create() 包裹 Radix 等组件库时,Radix 的原生 DOM 事件类型
 * (onDrag / onAnimationStart 等)会与 Motion 的手势/动画同名 prop 冲突,
 * TS 无法调和二者的交集。这些是库粘合组件,合并后的完整 prop 类型不带来
 * 额外安全价值,故用宽松签名:接受 Radix props(去掉冲突键)+ Motion 动画 props。
 */
type ConflictKeys =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragLeave"
  | "onDragOver"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "style";

export type MotionWrapped<P> = React.FC<
  Omit<P, ConflictKeys> &
    Pick<
      HTMLMotionProps<"div">,
      "initial" | "animate" | "exit" | "transition" | "style" | "layout" | "layoutId"
    >
>;

/** 临界阻尼,无回弹 —— 优雅、不抢注意力。对应 damping≈1.0 / response≈0.4 */
export const SPRING_UI: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.4,
};

/** 更快抵达,无回弹 —— 抽屉 / 下拉 / 弹出层。对应 response≈0.3 */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.3,
};

/** 轻微回弹 —— 仅用于携带动量的物理交互(拖拽释放 / flick)。对应 damping≈0.8 */
export const SPRING_BOUNCE: Transition = {
  type: "spring",
  bounce: 0.22,
  duration: 0.4,
};

/** reduced-motion 降级:短促 opacity 交叉淡入,无位移 / 无回弹 */
export const REDUCED_MOTION_FADE: Transition = {
  type: "tween",
  ease: "easeOut",
  duration: 0.2,
};

/**
 * 苹果动量投影(§6):用释放速度预测停靠点,而非从释放点就近吸附。
 * decelerationRate ≈ 0.998 常规滚动手感;0.99 更利落。
 */
export function projectMomentum(
  velocity: number,
  decelerationRate = 0.998
): number {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}
