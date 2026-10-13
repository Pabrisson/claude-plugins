---
description: Summarize the last implementation for reuse in other projects
model: sonnet
---

# Task: Create a Project-Agnostic Implementation Summary

Analyze the most recent implementation you completed in this conversation and create a comprehensive, reusable summary.

## Requirements

1. **Identify the Last Implementation**
   - Review the recent conversation history
   - Identify the last significant code implementation or feature you created

2. **Extract Core Problem & Solution**
   - Describe the **problem** that was solved (in generic terms)
   - Explain the **approach** taken to solve it
   - Document the **key decisions** and why they were made

3. **Generalize the Implementation**
   - Remove ALL project-specific references:
     - File paths (replace with generic descriptions like "main component file", "utility module")
     - Variable/function names specific to this project
     - Project-specific configurations or dependencies
   - Keep the **general pattern** and **logic**
   - Preserve the **technical approach** and **architecture**

4. **Create Reusable Template**

Provide the summary in this format:

```markdown
## Problem Statement
[Generic description of the problem that needed to be solved]

## Solution Approach
[High-level approach taken, with reasoning]

## Implementation Pattern

### Core Logic
[The main algorithm or pattern, with generic pseudocode or code snippets]

### Key Components
- Component 1: [Purpose and responsibilities]
- Component 2: [Purpose and responsibilities]

### Technical Decisions
- Decision 1: [What was chosen and why]
- Decision 2: [What was chosen and why]

### Code Structure
[Generalized code structure or template that can be adapted]

### Dependencies/Requirements
[Any libraries, tools, or prerequisites needed]

### Adaptation Notes
[How to adapt this implementation to a new project]
```

## Important Guidelines

- **Focus on the "what" and "why", not the "where"** - Explain what was implemented and why it works, not where it lives in this specific project
- **Make it educational** - Someone should be able to understand and recreate the implementation in any project
- **Include context** - Explain edge cases handled, trade-offs considered, and alternative approaches rejected
- **Be specific about the pattern** - Include enough technical detail to be actionable
- **Avoid project jargon** - Use standard technical terminology

This summary should serve as a **portable implementation guide** that can be dropped into any project with minimal adaptation.
