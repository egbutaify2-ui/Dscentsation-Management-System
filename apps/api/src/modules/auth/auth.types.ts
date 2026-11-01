export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roleCode: 'OWNER' | 'MANAGER' | 'STAFF';
  roleName: string;
  permissions: string[];
}
