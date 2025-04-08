import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../utils" // Assuming alias setup or use relative path '../../lib/utils'
import { Loader2 } from "../icons/Icons" // Assuming alias setup or use relative path '../icons/Icons'

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-gray-950 dark:focus-visible:ring-blue-500",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white hover:bg-blue-600/90 dark:bg-blue-500 dark:text-gray-50 dark:hover:bg-blue-500/90",
        destructive: "bg-red-600 text-white hover:bg-red-600/90 dark:bg-red-500 dark:text-white dark:hover:bg-red-500/90",
        outline: "border border-gray-300 bg-white hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-800 dark:hover:text-gray-50",
        secondary: "bg-gray-100 text-gray-900 hover:bg-gray-100/80 dark:bg-gray-800 dark:text-gray-50 dark:hover:bg-gray-800/80",
        ghost: "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-50",
        link: "text-blue-600 underline-offset-4 hover:underline dark:text-blue-500",
        // Adding light variant similar to Tremor's
        light: "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        xs: "h-8 rounded-md px-2.5 text-xs", // Added xs size
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        iconXs: "h-6 w-6 p-0", // Added small icon size
        iconSm: "h-8 w-8 p-0", // Added small icon size
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  icon?: React.ComponentType<{ className?: string; size?: number }>; // Accept icon component
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, icon: Icon, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const iconSize = size === 'xs' || size === 'iconXs' ? 14 : size === 'sm' || size === 'iconSm' ? 16 : 18; // Adjust icon size based on button size

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading ? (
          <Loader2 className={cn("animate-spin", children ? "mr-2" : "", "h-4 w-4")} /> // Use Loader2 from Icons
        ) : (
           Icon && <Icon size={iconSize} className={cn(children ? "mr-2" : "", "h-4 w-4")} aria-hidden="true" /> // Render passed icon
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
