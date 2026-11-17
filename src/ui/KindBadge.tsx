// PHYSICAL PART / SOFTWARE FUNCTION / CONCEPT badge, shown wherever a component is named.
import type { ComponentInfo } from '../model/types';
import { KIND_HELP, KIND_LABEL, kindOf } from '../model/kind';

export function KindBadge({ c }: { c: ComponentInfo }) {
  const k = kindOf(c);
  return (
    <span className={`kind kind-${k}`} title={KIND_HELP[k]} data-testid="kind-badge">
      {KIND_LABEL[k]}
    </span>
  );
}
