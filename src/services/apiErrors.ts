type ApiErrorPayload = {
  error?: string;
  message?: string;
  errors?: Record<string, string[] | string> | string[];
};

export function extractApiErrorMessage(error: unknown, fallback = 'Request failed.') {
  if (error instanceof Error && error.message && !error.message.startsWith('Request failed with')) {
    return error.message;
  }

  const axiosLike = error as {
    response?: { data?: ApiErrorPayload };
    message?: string;
  };

  const data = axiosLike.response?.data;
  if (data?.error) return String(data.error);
  if (data?.message) return String(data.message);

  if (data?.errors) {
    if (Array.isArray(data.errors)) {
      const first = data.errors.find(Boolean);
      if (first) return String(first);
    }
    if (typeof data.errors === 'object') {
      const firstEntry = Object.values(data.errors)[0];
      if (Array.isArray(firstEntry)) return String(firstEntry[0] || fallback);
      if (firstEntry) return String(firstEntry);
    }
  }

  if (axiosLike.message && !axiosLike.message.startsWith('Request failed with')) {
    return axiosLike.message;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
