# Secure Software Development Lifecycle (SSDLC) Evidence

**App:** Zoom Translator  
**Maintainer:** Jonah Carpenter  
**Last Updated:** October 2025  

---

## 1. Overview
This document outlines the Secure Software Development Lifecycle (SSDLC) practices followed for the **Zoom Translator** app.  
As this tool is developed and maintained by a single developer for **internal organizational use only**, the SSDLC focuses on practical, lightweight security measures that fit the scope and internal access of the application.

---

## 2. SSDLC Stages

### 2.1. Planning & Design
- Security considerations are reviewed at the start of each feature or update.  
- Data sensitivity and Zoom integration requirements are evaluated before implementation.  
- External dependencies are reviewed for licensing and known security issues.

### 2.2. Development
- Code is written following basic secure development practices:
  - Input validation and sanitization  
  - Proper output encoding  
  - Avoiding hard-coded credentials or tokens  
- Secret keys and API credentials are stored in environment variables or secure configuration files, not in the codebase.

### 2.3. Testing & Review
- Manual code review is performed by the developer prior to deployment.  
- Automated dependency checks (e.g., `npm audit`) are run as part of the development workflow.  
- As this is an internal-use tool, security testing is limited but reviewed when dependencies or API scopes change.

### 2.4. Deployment
- The app is deployed through a controlled CI/CD process.  
- Secrets are injected at runtime using environment variables.  
- Deployment environments are restricted to authorized internal systems.

### 2.5. Maintenance & Monitoring
- Dependencies are updated periodically to address security advisories.  
- Logs are reviewed for abnormal behavior or unauthorized access attempts.  
- Any security-related issues are reviewed and resolved directly by the developer.

---

## 3. Documentation & Evidence
- Design notes and development documentation are maintained in the internal repository.  
- Commit history and version control serve as evidence of review and change tracking.  
- Configuration and environment setup instructions are securely stored internally.

---

**Contact:**  
**Jonah Carpenter** — Developer  
📧 jcarpenter@uaminc.com  

**Internal Use Only**
