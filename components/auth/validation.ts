// Client-side checks for the sign-up and log-in forms (AUTH-1).
//
// These run in the browser for fast, clear feedback. They are NOT the security
// boundary: Miranda's database trigger rejects non-@umass.edu sign-ups on the
// server too, so nobody can skip this by calling Supabase directly.

export const MIN_PASSWORD_LENGTH = 8;

export type SignupValues = { fullName: string; email: string; password: string };
export type LoginValues = { email: string; password: string };

/** An error message per field. A field with no entry is valid. */
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export function isUmassEmail(email: string): boolean {
  // Something before the @, nothing but umass.edu after it, no spaces anywhere.
  return /^[^\s@]+@umass\.edu$/i.test(email.trim());
}

export function validateSignupField(field: keyof SignupValues, values: SignupValues): string | undefined {
  switch (field) {
    case "fullName":
      return values.fullName.trim() ? undefined : "Enter your full name.";
    case "email":
      if (!values.email.trim()) return "Enter your UMass email.";
      return isUmassEmail(values.email) ? undefined : "Use your @umass.edu email address.";
    case "password":
      return values.password.length >= MIN_PASSWORD_LENGTH
        ? undefined
        : `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
}

export function validateLoginField(field: keyof LoginValues, values: LoginValues): string | undefined {
  switch (field) {
    case "email":
      return values.email.trim() ? undefined : "Enter your email.";
    case "password":
      return values.password ? undefined : "Enter your password.";
  }
}

/** Runs every field's check and returns only the ones that failed. */
export function validateAll<T extends object>(
  values: T,
  validateField: (field: keyof T, values: T) => string | undefined,
): FieldErrors<T> {
  const errors: FieldErrors<T> = {};
  for (const field of Object.keys(values) as (keyof T)[]) {
    const message = validateField(field, values);
    if (message) errors[field] = message;
  }
  return errors;
}
