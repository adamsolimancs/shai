import type { CSSProperties, ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type StarBorderProps<T extends ElementType> = Omit<ComponentPropsWithoutRef<T>, "as" | "color"> & {
  as?: T;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
  color?: string;
  speed?: CSSProperties["animationDuration"];
  radius?: string;
  style?: CSSProperties;
};

const StarBorder = <T extends ElementType = "div">({
  as,
  className,
  contentClassName,
  children,
  color = "rgba(var(--color-app-primary-rgb) / 0.85)",
  speed = "6s",
  radius = "1.5rem",
  style,
  ...rest
}: StarBorderProps<T>) => {
  const Component = as || "div";
  const mergedStyle = {
    ...(style ?? {}),
    "--star-border-radius": radius,
  } as CSSProperties;
  const gradientStyle: CSSProperties = {
    background: `radial-gradient(circle, ${color}, transparent 10%)`,
    animationDuration: speed,
  };

  return (
    <Component className={cn("star-border-container", className)} style={mergedStyle} {...rest}>
      <div className="star-border-gradient star-border-gradient-bottom" style={gradientStyle} />
      <div className="star-border-gradient star-border-gradient-top" style={gradientStyle} />
      <div className={cn("star-border-inner", contentClassName)}>{children}</div>
    </Component>
  );
};

export default StarBorder;
