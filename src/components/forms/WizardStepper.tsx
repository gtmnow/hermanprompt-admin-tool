type WizardStepperProps = {
  steps: string[];
  activeIndex: number;
};

export function WizardStepper({ steps, activeIndex }: WizardStepperProps) {
  return (
    <div className="wizard-stepper">
      {steps.map((step, index) => (
        <div
          className={`wizard-stepper__item${index === activeIndex ? " wizard-stepper__item--active" : ""}`}
          key={step}
        >
          <span className="wizard-stepper__index">{index + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}
