import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from './cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        primary: 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300',
        success: 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-300',
        warning: 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-300',
        danger: 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-300',
        info: 'bg-info-50 text-info-700 dark:bg-info-950 dark:text-info-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
