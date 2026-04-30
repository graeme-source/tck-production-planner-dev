import { forwardRef, useEffect, useRef, useState } from "react";

type NativeProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

export type NumberInputProps = NativeProps & {
  value: number | null | undefined;
  onChange: (value: number) => void;
  // Number reported to the parent when the input is empty. Defaults to 0 so
  // the wrapper drops into existing call sites that store numbers (not nulls).
  emptyValue?: number;
};

// Plain `<input type="number" value={n}>` round-trips through the parent's
// number state on every keystroke, so when the user backspaces a "0" the
// value snaps right back to "0" before they can type a replacement digit.
// This wrapper holds the raw text locally and only reports a number to the
// parent — empty stays empty visually, parent state can stay non-nullable.
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ value, onChange, emptyValue = 0, ...rest }, ref) {
    const [text, setText] = useState(value == null ? "" : String(value));
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      // Sync external value changes (parent reset, async load) into the input,
      // but only when it isn't focused — otherwise the user's mid-edit empty
      // state gets clobbered by their own onChange round-tripping back as 0.
      const el = innerRef.current;
      if (el && document.activeElement === el) return;
      setText(value == null ? "" : String(value));
    }, [value]);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    return (
      <input
        ref={setRefs}
        type="number"
        value={text}
        onChange={e => {
          const raw = e.target.value;
          setText(raw);
          onChange(raw === "" ? emptyValue : Number(raw));
        }}
        {...rest}
      />
    );
  }
);
