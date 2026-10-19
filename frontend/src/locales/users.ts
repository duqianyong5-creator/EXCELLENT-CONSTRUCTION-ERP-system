import type { LocaleBundle } from './index';

export const users: LocaleBundle = {
  zh: {
    // 页头
    'users.title': '用户管理',
    'users.subtitle_admin': '管理员可创建、编辑、删除及重置账号。',
    'users.subtitle_dispatcher': '调度员可审核待处理账号。',
    'users.btn_create': '创建账号',

    // 统计卡片
    'users.stat_total': '账户总数',
    'users.stat_drivers': '司机',
    'users.stat_admins': '管理员',

    // 标签页
    'users.tab_all': '全部用户',
    'users.tab_pending': '待审核',

    // 角色
    'users.role_admin': '管理员',
    'users.role_dispatcher': '调度员',
    'users.role_driver': '司机',
    'users.role_client': '客户',
    'users.role_monitor': '监控大屏',

    // 状态
    'users.status_pending': '待审核',
    'users.status_active': '正常',
    'users.status_rejected': '已拒绝',
    'users.status_disabled': '已禁用',

    // 全部用户表格
    'users.col_username': '用户名',
    'users.col_name': '姓名',
    'users.col_role': '角色',
    'users.col_status': '状态',
    'users.col_actions': '操作',
    'users.btn_edit': '编辑',
    'users.btn_reset': '重置密码',
    'users.btn_delete': '删除',
    'users.delete_confirm_title': '确定删除该账号？',
    'users.delete_confirm_desc': '此操作不可撤销。',

    // 待审核表格
    'users.col_user': '用户',
    'users.col_requested_role': '申请角色',
    'users.col_requested_at': '申请时间',
    'users.col_review': '审核',
    'users.btn_approve': '通过',
    'users.btn_reject': '拒绝',

    // 弹窗标题
    'users.create_title': '创建账号',
    'users.edit_title': '编辑账户',
    'users.reset_title': '重置密码',

    // 表单
    'users.f_username': '用户名',
    'users.f_username_required': '请输入用户名',
    'users.f_email': '邮箱',
    'users.f_email_required': '请输入邮箱',
    'users.f_email_invalid': '邮箱格式不正确',
    'users.f_fullname': '姓名',
    'users.f_fullname_required': '请输入姓名',
    'users.f_phone': '电话',
    'users.f_role': '角色',
    'users.f_role_required': '请选择角色',
    'users.f_role_placeholder': '请选择角色',
    'users.f_status': '状态',
    'users.f_status_required': '请选择状态',
    'users.f_password': '密码',
    'users.f_password_required': '请输入密码',
    'users.f_password_min6': '密码至少 6 位',
    'users.f_new_password': '新密码',
    'users.f_new_password_required': '请输入新密码',
    'users.f_new_password_ph': '至少 6 位',
    'users.f_confirm_password': '确认密码',
    'users.f_confirm_required': '请再次输入密码',
    'users.f_confirm_mismatch': '两次输入的密码不一致',
    'users.f_confirm_ph': '再次输入新密码',

    // 表单按钮
    'users.btn_save': '保存',
    'users.btn_cancel': '取消',
    'users.btn_create_submit': '创建',
    'users.btn_reset_submit': '重置',

    // 提示
    'users.approved': '用户已通过',
    'users.rejected': '用户已拒绝',
    'users.updated': '账户已更新',
    'users.update_failed': '更新失败',
    'users.deleted': '用户已删除',
    'users.delete_failed': '删除失败',
    'users.password_reset': '密码已重置',
    'users.reset_failed': '重置失败',
    'users.created': '账号已创建',
    'users.create_failed': '创建失败',

    // 审核结果通知邮件
    'users.mail_title': '发送审核结果通知邮件',
    'users.mail_ok': '打开邮箱发送',
    'users.mail_to': '收件人：',
    'users.mail_address': '邮箱：',
    'users.mail_body_label': '邮件正文（可编辑）：',
    'users.mail_hint': '点击「打开邮箱发送」会用你电脑的邮箱客户端新建一封已填好的邮件，由你手动点击发送。无需配置服务器 SMTP。',
    'users.mail_subject_approved': '账户审核通过通知 - ECT 货运调度管理系统',
    'users.mail_subject_rejected': '账户审核结果通知 - ECT 货运调度管理系统',
    'users.mail_body_approved':
      '尊敬的 {{name}}，您好！\n\n' +
      '您的账户已通过管理员审核，现已可以正常登录使用。\n' +
      '登录账号：{{username}}\n\n' +
      '请使用注册时的账号与密码登录系统。\n\n' +
      '——ECT 货运调度管理系统',
    'users.mail_body_rejected':
      '尊敬的 {{name}}，您好！\n\n' +
      '很抱歉，您申请的账户（{{username}}）未通过管理员审核。\n' +
      '如有疑问，请联系管理员。\n\n' +
      '——ECT 货运调度管理系统',
  },
  en: {
    'users.title': 'User management',
    'users.subtitle_admin': 'Admins can create, edit, delete and reset accounts.',
    'users.subtitle_dispatcher': 'Dispatchers can review accounts waiting for approval.',
    'users.btn_create': 'New account',

    'users.stat_total': 'Total accounts',
    'users.stat_drivers': 'Drivers',
    'users.stat_admins': 'Admins',

    'users.tab_all': 'All users',
    'users.tab_pending': 'Pending',

    'users.role_admin': 'Admin',
    'users.role_dispatcher': 'Dispatcher',
    'users.role_driver': 'Driver',
    'users.role_client': 'Client',
    'users.role_monitor': 'Monitor display',

    'users.status_pending': 'Pending',
    'users.status_active': 'Active',
    'users.status_rejected': 'Rejected',
    'users.status_disabled': 'Disabled',

    'users.col_username': 'Username',
    'users.col_name': 'Name',
    'users.col_role': 'Role',
    'users.col_status': 'Status',
    'users.col_actions': 'Actions',
    'users.btn_edit': 'Edit',
    'users.btn_reset': 'Reset password',
    'users.btn_delete': 'Delete',
    'users.delete_confirm_title': 'Delete this account?',
    'users.delete_confirm_desc': 'This cannot be undone.',

    'users.col_user': 'User',
    'users.col_requested_role': 'Requested role',
    'users.col_requested_at': 'Requested',
    'users.col_review': 'Review',
    'users.btn_approve': 'Approve',
    'users.btn_reject': 'Reject',

    'users.create_title': 'New account',
    'users.edit_title': 'Edit account',
    'users.reset_title': 'Reset password',

    'users.f_username': 'Username',
    'users.f_username_required': 'Enter a username',
    'users.f_email': 'Email',
    'users.f_email_required': 'Enter an email address',
    'users.f_email_invalid': 'That email address is not valid',
    'users.f_fullname': 'Name',
    'users.f_fullname_required': 'Enter a name',
    'users.f_phone': 'Phone',
    'users.f_role': 'Role',
    'users.f_role_required': 'Select a role',
    'users.f_role_placeholder': 'Select a role',
    'users.f_status': 'Status',
    'users.f_status_required': 'Select a status',
    'users.f_password': 'Password',
    'users.f_password_required': 'Enter a password',
    'users.f_password_min6': 'Password must be at least 6 characters',
    'users.f_new_password': 'New password',
    'users.f_new_password_required': 'Enter a new password',
    'users.f_new_password_ph': 'At least 6 characters',
    'users.f_confirm_password': 'Confirm password',
    'users.f_confirm_required': 'Enter the password again',
    'users.f_confirm_mismatch': 'The two passwords do not match',
    'users.f_confirm_ph': 'Re-enter the new password',

    'users.btn_save': 'Save',
    'users.btn_cancel': 'Cancel',
    'users.btn_create_submit': 'Create',
    'users.btn_reset_submit': 'Reset',

    'users.approved': 'User approved',
    'users.rejected': 'User rejected',
    'users.updated': 'Account updated',
    'users.update_failed': 'Could not update the account',
    'users.deleted': 'User deleted',
    'users.delete_failed': 'Could not delete the user',
    'users.password_reset': 'Password reset',
    'users.reset_failed': 'Could not reset the password',
    'users.created': 'Account created',
    'users.create_failed': 'Could not create the account',

    'users.mail_title': 'Email the review result',
    'users.mail_ok': 'Open email client',
    'users.mail_to': 'To: ',
    'users.mail_address': 'Email: ',
    'users.mail_body_label': 'Message (you can edit it):',
    'users.mail_hint': 'Open email client starts a pre-filled message in the mail app on your computer; you still press send yourself. No SMTP server needed.',
    'users.mail_subject_approved': 'Your account has been approved - ECT Dispatch Management System',
    'users.mail_subject_rejected': 'Your account request - ECT Dispatch Management System',
    'users.mail_body_approved':
      'Hello {{name}},\n\n' +
      'Your account has been approved and you can now sign in.\n' +
      'Username: {{username}}\n\n' +
      'Please sign in with the username and password you registered with.\n\n' +
      '— ECT Dispatch Management System',
    'users.mail_body_rejected':
      'Hello {{name}},\n\n' +
      'Sorry, your account request ({{username}}) was not approved.\n' +
      'Please contact an administrator if you have any questions.\n\n' +
      '— ECT Dispatch Management System',
  },
};
