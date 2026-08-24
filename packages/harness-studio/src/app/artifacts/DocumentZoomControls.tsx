import { Minus } from "@phosphor-icons/react/Minus";
import { Plus } from "@phosphor-icons/react/Plus";

export function DocumentZoomControls(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): React.JSX.Element {
  const min = props.min ?? 50;
  const max = props.max ?? 200;
  const step = props.step ?? 25;
  return <div className="document-zoom-controls" role="group" aria-label={props.label}>
    <button
      type="button"
      aria-label="Zoom out"
      disabled={props.value <= min}
      onClick={() => props.onChange(Math.max(min, props.value - step))}
    ><Minus aria-hidden="true" size={14} /></button>
    <output>{props.value}%</output>
    <button
      type="button"
      aria-label="Zoom in"
      disabled={props.value >= max}
      onClick={() => props.onChange(Math.min(max, props.value + step))}
    ><Plus aria-hidden="true" size={14} /></button>
  </div>;
}
