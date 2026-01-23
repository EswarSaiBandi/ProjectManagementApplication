import * as React from "react"
import { cn } from "@/lib/utils"

function Avatar({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200 items-center justify-center text-sm font-medium",
                className
            )}
            {...props}
        >
            {children}
        </div>
    )
}

function AvatarImage({ className, src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
    return (
        <img
            className={cn("aspect-square h-full w-full", className)}
            src={src}
            alt={alt}
            {...props}
        />
    )
}

function AvatarFallback({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)} {...props} >
            {children}
        </div>
    )
}

export { Avatar, AvatarImage, AvatarFallback }
