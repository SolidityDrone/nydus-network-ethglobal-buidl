import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive"
  size?: "default" | "sm" | "lg" | "icon"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center border border-[#333333] text-sm font-mono font-bold uppercase transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
          {
            "bg-white text-black hover:bg-[#e0e0e0] active:bg-[#d0d0d0] border-white": variant === "default",
            "border border-[#333333] bg-transparent text-white hover:bg-[#1a1a1a] hover:border-white": variant === "outline",
            "text-[#888888] hover:text-white hover:bg-[#1a1a1a] border-transparent": variant === "ghost",
            "bg-white text-black hover:bg-[#e0e0e0] border-white": variant === "destructive",
            "h-10 px-4 py-2": size === "default",
            "h-9 px-3": size === "sm",
            "h-11 px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }

