/**
 * FTApi - thin wrapper around fetch() for talking to the Future Tech
 * backend (see /backend). Handles JSON encoding/decoding, auth headers,
 * and turns non-2xx responses into thrown Errors with a readable message.
 */
 const FTApi = (function () {
  const BASE = "https://future-tech-fullstack-7.onrender.com/";

  async function request(path, { method = "GET", body, token, headers } = {}) {
    const finalHeaders = { "Content-Type": "application/json", ...(headers || {}) };
    if (token) finalHeaders["Authorization"] = "Bearer " + token;

    // Never leave a page waiting forever on a server that accepted the
    // connection but never answers.
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;

    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });
    } catch (networkErr) {
      if (timer) clearTimeout(timer);
      throw new Error(
        networkErr && networkErr.name === "AbortError"
          ? "The server is taking too long to respond. Please try again in a moment."
          : "Could not reach the server. Please check your connection and make sure the backend is running."
      );
    }
    if (timer) clearTimeout(timer);

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // no JSON body (e.g. file download) - fine
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status; // lets callers tell "rate limited" (429) from "not found" (404) etc.
      throw err;
    }
    return data;
  }

  return {
    // ---- Authenticated file download ----
    // Unlike receipt downloads (unauthenticated capability URLs), some
    // files - like school invoices - sit behind a login. A plain <a href>
    // can't send an Authorization header, so fetch it as a blob and
    // trigger the save ourselves.
    downloadFile: async function (path, token, filename) {
      const res = await fetch(BASE + path, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) {
        let msg = `Download failed (${res.status}).`;
        try {
          const data = await res.json();
          if (data && data.error) msg = data.error;
        } catch (e) { /* non-JSON error body, keep default message */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    // ---- Authenticated file upload (PDF / video) ----
    // Unlike the small base64-JSON school-logo upload, PDFs/videos go
    // through here as real multipart/form-data - don't set Content-Type
    // yourself, the browser fills in the correct multipart boundary.
    uploadFile: async function (path, formData, token) {
      let res;
      try {
        res = await fetch(BASE + path, {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: formData,
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Please check your connection and make sure the backend is running.");
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* no JSON body */ }
      if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status}).`);
      return data;
    },

    // ---- Public config ----
    getConfig: () => request("/config"),

    // ---- Contact ----
    submitContact: (payload) => request("/contact", { method: "POST", body: payload }),

    // ---- Admissions ----
    createIndividualAdmission: (payload) =>
      request("/admissions/individual", { method: "POST", body: payload }),
    createBulkAdmission: (payload, token) =>
      request("/admissions/bulk", { method: "POST", body: payload, token }),

    // ---- Payments (UPI QR, manually confirmed by an admin) ----
    createPaymentOrder: (payload) =>
      request("/payments/create-order", { method: "POST", body: payload }),
    getPaymentStatus: (paymentId) => request(`/payments/${paymentId}/status`),

    // ---- Receipts ----
    receiptDownloadUrl: (paymentId) => BASE + `/receipts/${paymentId}/download`,

    // ---- School auth ----
    schoolLogin: (payload) => request("/auth/school/login", { method: "POST", body: payload }),
    schoolMe: (token) => request("/schools/me", { token }),
    schoolMyBulkAdmissions: (token) => request("/schools/me/bulk-admissions", { token }),
    schoolMyIndividualAdmissions: (token) => request("/schools/me/individual-admissions", { token }),
    schoolMarkPaymentPaid: (id, token) => request(`/schools/me/payments/${id}/mark-paid`, { method: "POST", token }),
    schoolMarkPaymentFailed: (id, token) => request(`/schools/me/payments/${id}/mark-failed`, { method: "POST", token }),
    changeSchoolPassword: (payload, token) =>
      request("/schools/me/change-password", { method: "POST", body: payload, token }),

    // ---- School directory (public) ----
    listSchools: () => request("/schools/list"),
    getIndividualAdmissionStats: () => request("/admissions/individual/stats"),

    // ---- Admin auth + data ----
    adminLogin: (payload) => request("/auth/admin/login", { method: "POST", body: payload }),
    adminSummary: (token) => request("/admin/summary", { token }),
    adminContacts: (token) => request("/admin/contacts", { token }),
    adminDeleteContact: (id, token) => request(`/admin/contacts/${id}`, { method: "DELETE", token }),
    adminIndividualAdmissions: (token) => request("/admin/admissions/individual", { token }),
    adminDeleteIndividual: (id, token) =>
      request(`/admin/admissions/individual/${id}`, { method: "DELETE", token }),
    adminBulkAdmissions: (token) => request("/admin/admissions/bulk", { token }),
    adminDeleteBulk: (id, token) => request(`/admin/admissions/bulk/${id}`, { method: "DELETE", token }),
    adminPayments: (token) => request("/admin/payments", { token }),
    adminMarkPaymentPaid: (id, token) => request(`/admin/payments/${id}/mark-paid`, { method: "POST", token }),
    adminMarkPaymentFailed: (id, token) => request(`/admin/payments/${id}/mark-failed`, { method: "POST", token }),
    adminSchools: (token) => request("/admin/schools", { token }),
    adminCreateSchool: (payload, token) => request("/admin/schools", { method: "POST", body: payload, token }),
    adminResetSchoolPassword: (id, token) =>
      request(`/admin/schools/${id}/reset-password`, { method: "POST", token }),
    adminToggleSchoolStatus: (id, token) =>
      request(`/admin/schools/${id}/toggle-status`, { method: "POST", token }),
    adminSchoolsRevenue: (token) => request("/admin/schools/revenue", { token }),
    adminSetSchoolUpi: (id, payload, token) =>
      request(`/admin/schools/${id}/upi`, { method: "POST", body: payload, token }),
    adminSetSchoolLogo: (id, logoDataUrl, token) =>
      request(`/admin/schools/${id}/logo`, { method: "POST", body: { logoDataUrl }, token }),
    adminRemoveSchoolLogo: (id, token) =>
      request(`/admin/schools/${id}/logo`, { method: "DELETE", token }),
    // Legacy - see the note on POST /schools/:id/razorpay-account in admin.js. No UI calls this anymore.
    adminSetSchoolRazorpayAccount: (id, payload, token) =>
      request(`/admin/schools/${id}/razorpay-account`, { method: "POST", body: payload, token }),
    adminGenerateSchoolInvoice: (id, payload, token) =>
      request(`/admin/schools/${id}/invoices`, { method: "POST", body: payload, token }),
    adminSchoolInvoices: (id, token) => request(`/admin/schools/${id}/invoices`, { token }),
    adminSchoolStatementUrl: (id, startDate, endDate) => {
      const qs = startDate && endDate ? `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}` : "";
      return `/admin/schools/${id}/statement${qs}`;
    },
    adminStudents: (token) => request("/admin/students", { token }),
    adminAddStudent: (payload, token) => request("/admin/students", { method: "POST", body: payload, token }),
    adminDeleteStudent: (id, token) => request(`/admin/students/${id}`, { method: "DELETE", token }),
    adminChangePassword: (payload, token) =>
      request("/admin/me/change-password", { method: "POST", body: payload, token }),

    // ---- Class content (per-class PDF/video) + Live Class link ----
    adminListClassContent: (level, moduleParam, token) =>
      request(`/admin/class-content/${level}/${moduleParam}`, { token }),
    adminCreateClassContent: (level, moduleParam, payload, token) =>
      request(`/admin/class-content/${level}/${moduleParam}`, { method: "POST", body: payload, token }),
    adminUpdateClassContent: (id, payload, token) =>
      request(`/admin/class-content/${id}`, { method: "PATCH", body: payload, token }),
    adminDeleteClassContent: (id, token) =>
      request(`/admin/class-content/${id}`, { method: "DELETE", token }),
    adminUploadClassPdf: (id, file, token) => {
      const fd = new FormData();
      fd.append("pdf", file);
      return FTApi.uploadFile(`/admin/class-content/${id}/pdf`, fd, token);
    },
    adminUploadClassVideo: (id, file, token) => {
      const fd = new FormData();
      fd.append("video", file);
      return FTApi.uploadFile(`/admin/class-content/${id}/video`, fd, token);
    },
    adminGetLiveClass: (level, moduleParam, token) =>
      request(`/admin/live-class/${level}/${moduleParam}`, { token }),
    adminSetLiveClass: (level, moduleParam, payload, token) =>
      request(`/admin/live-class/${level}/${moduleParam}`, { method: "PUT", body: payload, token }),

    // ---- Student LMS accounts (payment-gated registration) ----
    studentRegister: (payload) => request("/auth/student/register", { method: "POST", body: payload }),
    studentLogin: (payload) => request("/auth/student/login", { method: "POST", body: payload }),
    studentMe: (token) => request("/students/me", { token }),

    // ---- Quiz results / progress tracking ----
    saveQuizResult: (payload, token) =>
      request("/quiz-results", { method: "POST", body: payload, token }),
    myQuizResults: (token) => request("/quiz-results/me", { token }),
  };
})();
