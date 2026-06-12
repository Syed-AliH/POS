import type { ReactNode } from 'react';
import { Button } from './Button';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  onSubmit?: () => void;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export function PinPad({ value, onChange, maxLength = 6, onSubmit, disabled }: PinPadProps) {
  const handleKey = (key: string) => {
    if (disabled) return;
    if (key === 'clear') onChange('');
    else if (key === 'back') onChange(value.slice(0, -1));
    else if (value.length < maxLength) onChange(value + key);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-xs mx-auto">
      <div className="flex justify-center gap-2 h-12 items-center">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 ${
              i < value.length ? 'bg-primary-600 border-primary-600' : 'border-slate-300'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <Button
            key={key}
            variant={key === 'clear' ? 'danger' : key === 'back' ? 'ghost' : 'secondary'}
            size="lg"
            className="text-xl"
            onClick={() => handleKey(key)}
            disabled={disabled}
          >
            {key === 'clear' ? 'C' : key === 'back' ? '←' : key}
          </Button>
        ))}
      </div>
      {onSubmit && (
        <Button size="lg" onClick={onSubmit} disabled={disabled || value.length < 4}>
          Login
        </Button>
      )}
    </div>
  );
}
