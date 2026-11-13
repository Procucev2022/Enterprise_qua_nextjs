import { UI_STRINGS } from '@/lib/uiStrings';

/**
 * The mark shown beside the label of a mandatory field. It is hidden from assistive
 * technology because the input itself carries aria-required, which screen readers announce.
 */
export default function RequiredMarker() {
  return (
    <span className="ml-0.5 font-bold text-rose-600 dark:text-rose-400" aria-hidden="true">
      {UI_STRINGS.manualRfqModal.requiredMarker}
    </span>
  );
}
