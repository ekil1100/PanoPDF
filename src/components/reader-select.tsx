import { createSignal } from 'solid-js';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export interface ReaderChoice {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Controlled selection shared by the compact reader toolbar. */
export function ReaderSelect(props: {
  id: string;
  label: string;
  class?: string;
  title?: string;
  value: string;
  options: ReaderChoice[];
  disabled: boolean;
  hidden?: boolean;
  onChange(value: string): void;
  onCloseAutoFocus?(event: Event): void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <div hidden={props.hidden}>
      <Label class="sr-only" for={props.id}>
        {props.label}
      </Label>
      <Select<ReaderChoice>
        options={props.options}
        optionValue="value"
        optionTextValue="label"
        optionDisabled="disabled"
        value={props.options.find((option) => option.value === props.value) ?? null}
        onChange={(option) => {
          if (option) props.onChange(option.value);
        }}
        disabled={props.disabled}
        open={open() && !props.hidden && !props.disabled}
        onOpenChange={setOpen}
        placement="bottom-end"
        itemComponent={(item) => (
          <SelectItem item={item.item} data-value={item.item.rawValue.value}>
            {item.item.rawValue.label}
          </SelectItem>
        )}
      >
        <SelectTrigger
          id={props.id}
          class={props.class}
          title={props.title}
          aria-label={props.label}
          data-reader
        >
          <SelectValue<ReaderChoice> class="ui:truncate">
            {(state) => state.selectedOption().label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={(event) => props.onCloseAutoFocus?.(event)} />
      </Select>
    </div>
  );
}
