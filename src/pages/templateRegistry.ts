import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

export interface TemplatePageDefinition {
  path: string;
  templatePath: string;
  title: string;
  component: LazyExoticComponent<ComponentType>;
  category: string;
}

const AuthComplete_registrationPage = lazy(() => import('./template-pages/AuthComplete_registrationPage.tsx'));
const AuthLoginPage = lazy(() => import('./template-pages/AuthLoginPage.tsx'));
const AuthRegisterPage = lazy(() => import('./template-pages/AuthRegisterPage.tsx'));
const BatchesAddPage = lazy(() => import('./template-pages/BatchesAddPage.tsx'));
const BatchesEditPage = lazy(() => import('./template-pages/BatchesEditPage.tsx'));
const BatchesListPage = lazy(() => import('./template-pages/BatchesListPage.tsx'));
const ComponentsNotification_bellPage = lazy(() => import('./template-pages/ComponentsNotification_bellPage.tsx'));
const ComponentsNotification_contextPage = lazy(() => import('./template-pages/ComponentsNotification_contextPage.tsx'));
const CoursesAddPage = lazy(() => import('./template-pages/CoursesAddPage.tsx'));
const CoursesEditPage = lazy(() => import('./template-pages/CoursesEditPage.tsx'));
const CoursesListPage = lazy(() => import('./template-pages/CoursesListPage.tsx'));
const DashboardPage = lazy(() => import('./template-pages/DashboardPage.tsx'));
const EnquiriesAddPage = lazy(() => import('./template-pages/EnquiriesAddPage.tsx'));
const EnquiriesEditPage = lazy(() => import('./template-pages/EnquiriesEditPage.tsx'));
const EnquiriesListPage = lazy(() => import('./template-pages/EnquiriesListPage.tsx'));
const Errors400Page = lazy(() => import('./template-pages/Errors400Page.tsx'));
const Errors401Page = lazy(() => import('./template-pages/Errors401Page.tsx'));
const Errors403Page = lazy(() => import('./template-pages/Errors403Page.tsx'));
const Errors404Page = lazy(() => import('./template-pages/Errors404Page.tsx'));
const Errors500Page = lazy(() => import('./template-pages/Errors500Page.tsx'));
const ExportsOptionsPage = lazy(() => import('./template-pages/ExportsOptionsPage.tsx'));
const FeesPaymentPage = lazy(() => import('./template-pages/FeesPaymentPage.tsx'));
const LegalPrivacy_policyPage = lazy(() => import('./template-pages/LegalPrivacy_policyPage.tsx'));
const LegalTerms_of_servicePage = lazy(() => import('./template-pages/LegalTerms_of_servicePage.tsx'));
const NotificationsPage = lazy(() => import('./template-pages/NotificationsPage.tsx'));
const ReportsBatchesPage = lazy(() => import('./template-pages/ReportsBatchesPage.tsx'));
const ReportsEnquiriesPage = lazy(() => import('./template-pages/ReportsEnquiriesPage.tsx'));
const ReportsFeesPage = lazy(() => import('./template-pages/ReportsFeesPage.tsx'));
const ReportsPage = lazy(() => import('./template-pages/ReportsPage.tsx'));
const ReportsStudentsPage = lazy(() => import('./template-pages/ReportsStudentsPage.tsx'));
const SchemesAddPage = lazy(() => import('./template-pages/SchemesAddPage.tsx'));
const SchemesEditPage = lazy(() => import('./template-pages/SchemesEditPage.tsx'));
const SchemesListPage = lazy(() => import('./template-pages/SchemesListPage.tsx'));
const SettingsAttendancePage = lazy(() => import('./template-pages/SettingsAttendancePage.tsx'));
const SettingsBackupPage = lazy(() => import('./template-pages/SettingsBackupPage.tsx'));
const SettingsInvoicesPage = lazy(() => import('./template-pages/SettingsInvoicesPage.tsx'));
const SettingsLogoPage = lazy(() => import('./template-pages/SettingsLogoPage.tsx'));
const SettingsProfilePage = lazy(() => import('./template-pages/SettingsProfilePage.tsx'));
const StaffAddPage = lazy(() => import('./template-pages/StaffAddPage.tsx'));
const StaffAttendance_listPage = lazy(() => import('./template-pages/StaffAttendance_listPage.tsx'));
const StaffCorrectionsPage = lazy(() => import('./template-pages/StaffCorrectionsPage.tsx'));
const StaffDashboardPage = lazy(() => import('./template-pages/StaffDashboardPage.tsx'));
const StaffEditPage = lazy(() => import('./template-pages/StaffEditPage.tsx'));
const StaffLeave_requestsPage = lazy(() => import('./template-pages/StaffLeave_requestsPage.tsx'));
const StaffListPage = lazy(() => import('./template-pages/StaffListPage.tsx'));
const StaffReportsPage = lazy(() => import('./template-pages/StaffReportsPage.tsx'));
const StudentsAddPage = lazy(() => import('./template-pages/StudentsAddPage.tsx'));
const StudentsEditPage = lazy(() => import('./template-pages/StudentsEditPage.tsx'));
const StudentsListPage = lazy(() => import('./template-pages/StudentsListPage.tsx'));
const StudentsViewPage = lazy(() => import('./template-pages/StudentsViewPage.tsx'));
const SubscriptionPaymentPage = lazy(() => import('./template-pages/SubscriptionPaymentPage.tsx'));
const SubscriptionPlansPage = lazy(() => import('./template-pages/SubscriptionPlansPage.tsx'));
const SubscriptionSuccessPage = lazy(() => import('./template-pages/SubscriptionSuccessPage.tsx'));

export const templatePages: TemplatePageDefinition[] = [
  {
    "path": "/auth-complete_registration",
    "templatePath": "auth/complete_registration.html",
    "title": "Complete Registration",
    "component": AuthComplete_registrationPage,
    "category": "auth"
  },
  {
    "path": "/auth-login",
    "templatePath": "auth/login.html",
    "title": "Login",
    "component": AuthLoginPage,
    "category": "auth"
  },
  {
    "path": "/auth-register",
    "templatePath": "auth/register.html",
    "title": "Complete Registration",
    "component": AuthRegisterPage,
    "category": "auth"
  },
  {
    "path": "/batches-add",
    "templatePath": "batches/add.html",
    "title": "Add Batch",
    "component": BatchesAddPage,
    "category": "batches"
  },
  {
    "path": "/batches-edit",
    "templatePath": "batches/edit.html",
    "title": "Edit Batch",
    "component": BatchesEditPage,
    "category": "batches"
  },
  {
    "path": "/batches-list",
    "templatePath": "batches/list.html",
    "title": "Batches",
    "component": BatchesListPage,
    "category": "batches"
  },
  {
    "path": "/components-notification_bell",
    "templatePath": "components/notification_bell.html",
    "title": "Components / Notification bell",
    "component": ComponentsNotification_bellPage,
    "category": "components"
  },
  {
    "path": "/components-notification_context",
    "templatePath": "components/notification_context.html",
    "title": "Components / Notification context",
    "component": ComponentsNotification_contextPage,
    "category": "components"
  },
  {
    "path": "/courses-add",
    "templatePath": "courses/add.html",
    "title": "Add Course",
    "component": CoursesAddPage,
    "category": "courses"
  },
  {
    "path": "/courses-edit",
    "templatePath": "courses/edit.html",
    "title": "Edit Course",
    "component": CoursesEditPage,
    "category": "courses"
  },
  {
    "path": "/courses-list",
    "templatePath": "courses/list.html",
    "title": "Courses",
    "component": CoursesListPage,
    "category": "courses"
  },
  {
    "path": "/dashboard",
    "templatePath": "dashboard/index.html",
    "title": "Dashboard",
    "component": DashboardPage,
    "category": "dashboard"
  },
  {
    "path": "/enquiries-add",
    "templatePath": "enquiries/add.html",
    "title": "Add Enquiry",
    "component": EnquiriesAddPage,
    "category": "enquiries"
  },
  {
    "path": "/enquiries-edit",
    "templatePath": "enquiries/edit.html",
    "title": "Edit Enquiry",
    "component": EnquiriesEditPage,
    "category": "enquiries"
  },
  {
    "path": "/enquiries-list",
    "templatePath": "enquiries/list.html",
    "title": "Enquiries",
    "component": EnquiriesListPage,
    "category": "enquiries"
  },
  {
    "path": "/errors-400",
    "templatePath": "errors/400.html",
    "title": "Errors / 400",
    "component": Errors400Page,
    "category": "errors"
  },
  {
    "path": "/errors-401",
    "templatePath": "errors/401.html",
    "title": "Errors / 401",
    "component": Errors401Page,
    "category": "errors"
  },
  {
    "path": "/errors-403",
    "templatePath": "errors/403.html",
    "title": "Errors / 403",
    "component": Errors403Page,
    "category": "errors"
  },
  {
    "path": "/errors-404",
    "templatePath": "errors/404.html",
    "title": "Errors / 404",
    "component": Errors404Page,
    "category": "errors"
  },
  {
    "path": "/errors-500",
    "templatePath": "errors/500.html",
    "title": "Errors / 500",
    "component": Errors500Page,
    "category": "errors"
  },
  {
    "path": "/exports-options",
    "templatePath": "exports/options.html",
    "title": "Data Management",
    "component": ExportsOptionsPage,
    "category": "exports"
  },
  {
    "path": "/fees-payment",
    "templatePath": "fees/payment.html",
    "title": "Record Payment",
    "component": FeesPaymentPage,
    "category": "fees"
  },
  {
    "path": "/legal-privacy_policy",
    "templatePath": "legal/privacy_policy.html",
    "title": "Privacy Policy",
    "component": LegalPrivacy_policyPage,
    "category": "legal"
  },
  {
    "path": "/legal-terms_of_service",
    "templatePath": "legal/terms_of_service.html",
    "title": "Terms of Service",
    "component": LegalTerms_of_servicePage,
    "category": "legal"
  },
  {
    "path": "/notifications",
    "templatePath": "notifications/index.html",
    "title": "Notifications",
    "component": NotificationsPage,
    "category": "notifications"
  },
  {
    "path": "/reports-batches",
    "templatePath": "reports/batches.html",
    "title": "Batch Report",
    "component": ReportsBatchesPage,
    "category": "reports"
  },
  {
    "path": "/reports-enquiries",
    "templatePath": "reports/enquiries.html",
    "title": "Enquiry Report",
    "component": ReportsEnquiriesPage,
    "category": "reports"
  },
  {
    "path": "/reports-fees",
    "templatePath": "reports/fees.html",
    "title": "Financial Report",
    "component": ReportsFeesPage,
    "category": "reports"
  },
  {
    "path": "/reports",
    "templatePath": "reports/index.html",
    "title": "Reports",
    "component": ReportsPage,
    "category": "reports"
  },
  {
    "path": "/reports-students",
    "templatePath": "reports/students.html",
    "title": "Student Report",
    "component": ReportsStudentsPage,
    "category": "reports"
  },
  {
    "path": "/schemes-add",
    "templatePath": "schemes/add.html",
    "title": "Add Scheme",
    "component": SchemesAddPage,
    "category": "schemes"
  },
  {
    "path": "/schemes-edit",
    "templatePath": "schemes/edit.html",
    "title": "Edit Scheme",
    "component": SchemesEditPage,
    "category": "schemes"
  },
  {
    "path": "/schemes-list",
    "templatePath": "schemes/list.html",
    "title": "Schemes",
    "component": SchemesListPage,
    "category": "schemes"
  },
  {
    "path": "/settings-attendance",
    "templatePath": "settings/attendance.html",
    "title": "Attendance Settings",
    "component": SettingsAttendancePage,
    "category": "settings"
  },
  {
    "path": "/settings-backup",
    "templatePath": "settings/backup.html",
    "title": "Backup & Restore",
    "component": SettingsBackupPage,
    "category": "settings"
  },
  {
    "path": "/settings-invoices",
    "templatePath": "settings/invoices.html",
    "title": "Subscription Invoices",
    "component": SettingsInvoicesPage,
    "category": "settings"
  },
  {
    "path": "/settings-logo",
    "templatePath": "settings/logo.html",
    "title": "Settings",
    "component": SettingsLogoPage,
    "category": "settings"
  },
  {
    "path": "/settings-profile",
    "templatePath": "settings/profile.html",
    "title": "Profile Settings",
    "component": SettingsProfilePage,
    "category": "settings"
  },
  {
    "path": "/staff-add",
    "templatePath": "staff/add.html",
    "title": "Add Staff",
    "component": StaffAddPage,
    "category": "staff"
  },
  {
    "path": "/staff-attendance_list",
    "templatePath": "staff/attendance_list.html",
    "title": "Staff Attendance",
    "component": StaffAttendance_listPage,
    "category": "staff"
  },
  {
    "path": "/staff-corrections",
    "templatePath": "staff/corrections.html",
    "title": "Attendance Corrections",
    "component": StaffCorrectionsPage,
    "category": "staff"
  },
  {
    "path": "/staff-dashboard",
    "templatePath": "staff/dashboard.html",
    "title": "Staff Dashboard",
    "component": StaffDashboardPage,
    "category": "staff"
  },
  {
    "path": "/staff-edit",
    "templatePath": "staff/edit.html",
    "title": "Edit Staff",
    "component": StaffEditPage,
    "category": "staff"
  },
  {
    "path": "/staff-leave_requests",
    "templatePath": "staff/leave_requests.html",
    "title": "Leave Requests",
    "component": StaffLeave_requestsPage,
    "category": "staff"
  },
  {
    "path": "/staff-list",
    "templatePath": "staff/list.html",
    "title": "Staff Management",
    "component": StaffListPage,
    "category": "staff"
  },
  {
    "path": "/staff-reports",
    "templatePath": "staff/reports.html",
    "title": "Staff Reports",
    "component": StaffReportsPage,
    "category": "staff"
  },
  {
    "path": "/students-add",
    "templatePath": "students/add.html",
    "title": "Add Student",
    "component": StudentsAddPage,
    "category": "students"
  },
  {
    "path": "/students-edit",
    "templatePath": "students/edit.html",
    "title": "Edit Student",
    "component": StudentsEditPage,
    "category": "students"
  },
  {
    "path": "/students-list",
    "templatePath": "students/list.html",
    "title": "Students",
    "component": StudentsListPage,
    "category": "students"
  },
  {
    "path": "/students-view",
    "templatePath": "students/view.html",
    "title": "{{ student.name }}",
    "component": StudentsViewPage,
    "category": "students"
  },
  {
    "path": "/subscription-payment",
    "templatePath": "subscription/payment.html",
    "title": "Complete Subscription",
    "component": SubscriptionPaymentPage,
    "category": "subscription"
  },
  {
    "path": "/subscription-plans",
    "templatePath": "subscription/plans.html",
    "title": "Subscription Plans",
    "component": SubscriptionPlansPage,
    "category": "subscription"
  },
  {
    "path": "/subscription-success",
    "templatePath": "subscription/success.html",
    "title": "Payment Success",
    "component": SubscriptionSuccessPage,
    "category": "subscription"
  }
];

export const defaultPagePath = '/dashboard';
