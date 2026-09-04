import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Aiven rules: Primary and Secondary are pills; Ghost, Text and Icon keep the 4px default.
// Primary is grey (teal is the *secondary* colour) and a grey-bordered pill does not exist,
// so `outline` is the teal secondary too. Focus is a 2px teal outline, always visible.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "min-w-[52px] rounded-full bg-primary text-primary-foreground hover:bg-[#444547] active:bg-[#68696B] dark:hover:bg-[#E1E1E1] dark:active:bg-[#B5B5B7]",
        outline:
          "min-w-[52px] rounded-full border-secondary-foreground bg-transparent text-secondary-foreground hover:bg-secondary aria-expanded:bg-secondary",
        secondary:
          "min-w-[52px] rounded-full border-secondary-foreground bg-transparent text-secondary-foreground hover:bg-secondary aria-expanded:bg-secondary",
        ghost:
          "rounded-md hover:bg-accent hover:text-secondary-foreground aria-expanded:bg-accent",
        destructive:
          "min-w-[52px] rounded-full bg-destructive text-destructive-foreground hover:brightness-110",
        link: "rounded-md text-secondary-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        // Icon buttons are square with the 4px radius, never pills.
        icon: "size-8 min-w-0 rounded-md",
        "icon-xs": "size-6 min-w-0 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 min-w-0 rounded-md",
        "icon-lg": "size-9 min-w-0 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
