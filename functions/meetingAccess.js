// Who may use «اجتماعات أولياء الأمور» (and «تقييمات أولياء الأمور», which
// belongs to it): users.modules.meetings, on by default for principals,
// upper management and customer service. Mirrors src/utils/scope.js
// meetingsByRole().
const meetingsByRole = (u) => u.isPrincipal === true || ["UPPER_MANAGEMENT", "CUSTOMER_SERVICE"].includes(u.role);
const meetingsAllowed = (u) => !!u && u.active !== false && u.role !== "RECEPTIONIST" && u.tripsAccess !== "tripsOnly"
  && (u.role === "ADMIN" || (typeof u.modules?.meetings === "boolean" ? u.modules.meetings : meetingsByRole(u)));

module.exports = { meetingsByRole, meetingsAllowed };
