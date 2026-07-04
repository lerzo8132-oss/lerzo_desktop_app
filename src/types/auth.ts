export interface SubscriptionInfo {
  status?: string;
  days_remaining?: number;
  expiry_date?: string | null;
  plan_name?: string;
  plan_type?: string;
  is_active?: boolean;
  trial_used?: boolean;
  trial_eligible?: boolean;
  account_status?: string;
  permanent_active?: boolean;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  unique_id?: string | null;
  center_name?: string | null;
  centre?: string | null;
  role?: string | null;
  permissions?: string[];
  is_super_admin?: boolean;
  profile_pic?: string | null;
  avatar?: string | null;
  logo_filename?: string | null;
  account_number?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  subscription?: SubscriptionInfo;
}

export interface ApiResponse<T> {
  success: boolean;
  error?: string;
  message?: string;
  token?: string;
  user?: CurrentUser;
  data?: T;
}
