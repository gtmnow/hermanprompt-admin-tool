type WizardStepperProps = {
  steps: string[];
  activeIndex: number;
  onStepSelect?: (index: number) => void;
  disabled?: boolean;
};

export function WizardStepper({ steps, activeIndex, onStepSelect, disabled = false }: WizardStepperProps) {
  return (
    <div className="wizard-stepper">
      {steps.map((step, index) => (
        <button
          type="button"
          className={`wizard-stepper__item${index === activeIndex ? " wizard-stepper__item--active" : ""}`}
          key={step}
          onClick={() => onStepSelect?.(index)}
          disabled={disabled}
        >
          <span className="wizard-stepper__index">{index + 1}</span>
          <span>{step}</span>
        </button>
      ))}
    </div>
  );
}
