import { lazy } from 'react';

const AuthComplete_registrationPage = lazy(() => import('./template-pages/AuthComplete_registrationPage.jsx'));
const AuthLoginPage = lazy(() => import('./template-pages/AuthLoginPage.jsx'));
const AuthRegisterPage = lazy(() => import('./template-pages/AuthRegisterPage.jsx'));
const BatchesAddPage = lazy(() => import('./template-pages/BatchesAddPage.jsx'));
const BatchesEditPage = lazy(() => import('./template-pages/BatchesEditPage.jsx'));
const BatchesListPage = lazy(() => import('./template-pages/BatchesListPage.jsx'));
const ComponentsNotification_bellPage = lazy(() => import('./template-pages/ComponentsNotification_bellPage.jsx'));
const ComponentsNotification_contextPage = lazy(() => import('./template-pages/ComponentsNotification_contextPage.jsx'));
const CoursesAddPage = lazy(() => import('./template-pages/CoursesAddPage.jsx'));
const CoursesEditPage = lazy(() => import('./template-pages/CoursesEditPage.jsx'));
const CoursesListPage = lazy(() => import('./template-pages/CoursesListPage.jsx'));
const DashboardPage = lazy(() => import('./template-pages/DashboardPage.jsx'));
const EnquiriesAddPage = lazy(() => import('./template-pages/EnquiriesAddPage.jsx'));
const EnquiriesEditPage = lazy(() => import('./template-pages/EnquiriesEditPage.jsx'));
const EnquiriesListPage = lazy(() => import('./template-pages/EnquiriesListPage.jsx'));
const Errors400Page = lazy(() => import('./template-pages/Errors400Page.jsx'));
const Errors401Page = lazy(() => import('./template-pages/Errors401Page.jsx'));
const Errors403Page = lazy(() => import('./template-pages/Errors403Page.jsx'));
const Errors404Page = lazy(() => import('./template-pages/Errors404Page.jsx'));
const Errors500Page = lazy(() => import('./template-pages/Errors500Page.jsx'));
const ExportsOptionsPage = lazy(() => import('./template-pages/ExportsOptionsPage.jsx'));
const FeesPaymentPage = lazy(() => import('./template-pages/FeesPaymentPage.jsx'));
const LegalPrivacy_policyPage = lazy(() => import('./template-pages/LegalPrivacy_policyPage.jsx'));
const LegalTerms_of_servicePage = lazy(() => import('./template-pages/LegalTerms_of_servicePage.jsx'));
const NotificationsPage = lazy(() => import('./template-pages/NotificationsPage.jsx'));
const ReportsBatchesPage = lazy(() => import('./template-pages/ReportsBatchesPage.jsx'));
const ReportsEnquiriesPage = lazy(() => import('./template-pages/ReportsEnquiriesPage.jsx'));
const ReportsFeesPage = lazy(() => import('./template-pages/ReportsFeesPage.jsx'));
const ReportsPage = lazy(() => import('./template-pages/ReportsPage.jsx'));
const ReportsStudentsPage = lazy(() => import('./template-pages/ReportsStudentsPage.jsx'));
const SchemesAddPage = lazy(() => import('./template-pages/SchemesAddPage.jsx'));
const SchemesEditPage = lazy(() => import('./template-pages/SchemesEditPage.jsx'));
const SchemesListPage = lazy(() => import('./template-pages/SchemesListPage.jsx'));
const SettingsAttendancePage = lazy(() => import('./template-pages/SettingsAttendancePage.jsx'));
const SettingsBackupPage = lazy(() => import('./template-pages/SettingsBackupPage.jsx'));
const SettingsInvoicesPage = lazy(() => import('./template-pages/SettingsInvoicesPage.jsx'));
const SettingsLogoPage = lazy(() => import('./template-pages/SettingsLogoPage.jsx'));
const SettingsProfilePage = lazy(() => import('./template-pages/SettingsProfilePage.jsx'));
const StaffAddPage = lazy(() => import('./template-pages/StaffAddPage.jsx'));
const StaffAttendance_listPage = lazy(() => import('./template-pages/StaffAttendance_listPage.jsx'));
const StaffCorrectionsPage = lazy(() => import('./template-pages/StaffCorrectionsPage.jsx'));
const StaffDashboardPage = lazy(() => import('./template-pages/StaffDashboardPage.jsx'));
const StaffEditPage = lazy(() => import('./template-pages/StaffEditPage.jsx'));
const StaffLeave_requestsPage = lazy(() => import('./template-pages/StaffLeave_requestsPage.jsx'));
const StaffListPage = lazy(() => import('./template-pages/StaffListPage.jsx'));
const StaffReportsPage = lazy(() => import('./template-pages/StaffReportsPage.jsx'));
const StudentsAddPage = lazy(() => import('./template-pages/StudentsAddPage.jsx'));
const StudentsEditPage = lazy(() => import('./template-pages/StudentsEditPage.jsx'));
const StudentsListPage = lazy(() => import('./template-pages/StudentsListPage.jsx'));
const StudentsViewPage = lazy(() => import('./template-pages/StudentsViewPage.jsx'));
const SubscriptionPaymentPage = lazy(() => import('./template-pages/SubscriptionPaymentPage.jsx'));
const SubscriptionPlansPage = lazy(() => import('./template-pages/SubscriptionPlansPage.jsx'));
const SubscriptionSuccessPage = lazy(() => import('./template-pages/SubscriptionSuccessPage.jsx'));

export const templatePages = [
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
