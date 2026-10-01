import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}
export default function Select({
  value,
  onChange,
  label,
  options,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Option[];
  compact?: boolean;
}) {
  return (
    <Primitive.Root value={value} onValueChange={onChange}>
      <Primitive.Trigger
        className={`select-trigger ${compact ? "compact" : ""}`}
        aria-label={label}
      >
        <Primitive.Value />
        <Primitive.Icon asChild>
          <ChevronDown size={15} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          className="select-menu"
          position="popper"
          sideOffset={7}
          collisionPadding={12}
          data-research-select-content
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-options">
            {options.map((option) => (
              <Primitive.Item
                className="select-option"
                value={option.value}
                disabled={option.disabled}
                key={option.value}
              >
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator>
                  <Check size={14} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
