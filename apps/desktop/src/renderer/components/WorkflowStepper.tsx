interface Step {
  id: string;
  label: string;
  hint?: string;
}

interface WorkflowStepperProps {
  steps: Step[];
  currentStep: number;
}

export function WorkflowStepper({ steps, currentStep }: WorkflowStepperProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      {steps.map((step, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        return (
          <div key={step.id} className="flex shrink-0 items-center gap-1">
            {index > 0 && <span className="mx-1 text-slate-300 dark:text-slate-600">→</span>}
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary-600 text-white'
                  : done
                    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
              title={step.hint}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  active
                    ? 'bg-white text-primary-600'
                    : done
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-300 text-white dark:bg-slate-600'
                }`}
              >
                {done ? '✓' : index + 1}
              </span>
              <span>{step.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
