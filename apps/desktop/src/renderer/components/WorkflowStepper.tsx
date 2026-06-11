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
    <div className="flex items-center gap-1 px-4 py-2 bg-white border-b border-slate-100 overflow-x-auto shrink-0">
      {steps.map((step, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {index > 0 && <span className="text-slate-300 mx-1">→</span>}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? 'bg-pink-600 text-white' : done ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
              }`}
              title={step.hint}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                active ? 'bg-white text-pink-600' : done ? 'bg-green-600 text-white' : 'bg-slate-300 text-white'
              }`}>
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
