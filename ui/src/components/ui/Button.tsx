import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../utils" // Assuming alias setup or use relative path '../../lib/utils'
import { ReloadIcon } from "@radix-ui/react-icons" // Import Radix reload icon

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
        iconXs: "h-6 w-6", // Keep size definitions
        iconSm: "h-8 w-8",
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
  icon?: React.ElementType; // Use React.ElementType for the icon prop
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, icon: Icon, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    // Determine icon size class based on button size prop
    const iconSizeClasses =
      size === 'lg' ? 'h-5 w-5' :
      size === 'sm' ? 'h-4 w-4' :
      size === 'xs' ? 'h-3.5 w-3.5' :
      size === 'icon' ? 'h-5 w-5' : // Use size for icon-only buttons
      size === 'iconSm' ? 'h-4 w-4' :
      size === 'iconXs' ? 'h-3.5 w-3.5' :
      'h-4 w-4'; // Default size

    const hasTextChildren = React.Children.toArray(children).some(child =>
      typeof child === 'string' && child.trim().length > 0
    );

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading ? (
          <ReloadIcon className={cn("animate-spin", hasTextChildren ? "mr-2" : "", iconSizeClasses)} />
        ) : (
          Icon && <Icon className={cn(hasTextChildren ? "mr-2" : "", iconSizeClasses)} aria-hidden="true" />
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
