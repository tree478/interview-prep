"use client";

import { useState } from "react";
import { validateAll, type FieldErrors } from "./validation";

// Form state + validation timing shared by the sign-up and log-in forms.
//
// When errors appear:
// - On blur (leaving a field), if something was typed. Tabbing past an empty
//   field doesn't nag.
// - While typing, only for a field that's already showing an error, so the
//   message disappears the moment it's fixed.
// - On submit, every field is checked and focus jumps to the first bad one.
export function useValidatedForm<T extends Record<string, string>>(
  initialValues: T,
  validateField: (field: keyof T, values: T) => string | undefined,
  idPrefix: string,
) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<T>>({});

  /** Everything a <FormField> needs for one field: spread it in with {...field("email")}. */
  function field(name: keyof T) {
    return {
      id: `${idPrefix}${String(name)}`,
      name: String(name),
      value: values[name],
      error: errors[name],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const next = { ...values, [name]: e.target.value };
        setValues(next);
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: validateField(name, next) }));
      },
      onBlur: () => {
        if (values[name] !== "") setErrors((prev) => ({ ...prev, [name]: validateField(name, values) }));
      },
    };
  }

  /** Checks every field. Returns true when the form can be sent. */
  function validateForSubmit(): boolean {
    const all = validateAll(values, validateField);
    setErrors(all);
    const firstInvalid = (Object.keys(values) as (keyof T)[]).find((name) => all[name]);
    if (firstInvalid !== undefined) {
      document.getElementById(`${idPrefix}${String(firstInvalid)}`)?.focus();
      return false;
    }
    return true;
  }

  return { values, field, validateForSubmit };
}
