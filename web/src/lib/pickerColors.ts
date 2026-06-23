export interface PickerItemColors {
  border: string;
  number: string;
  background: string;
  showDefaultBadge: boolean;
}

/** Colors for one monitor icon. Selected (green) outranks primary (amber) for
 *  the border/background; the amber "Default" badge is shown whenever primary. */
export function pickerItemColors(isPrimary: boolean, isSelected: boolean): PickerItemColors {
  const border = isSelected ? '#34d399' : isPrimary ? '#f59e0b' : '#3f4754';
  const background = isSelected ? 'rgba(52,211,153,0.15)' : 'transparent';
  const number = isPrimary ? '#f59e0b' : isSelected ? '#34d399' : '#cbd5e1';
  return { border, number, background, showDefaultBadge: isPrimary };
}
