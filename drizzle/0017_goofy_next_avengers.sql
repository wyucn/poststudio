ALTER TABLE `project_members` ADD `role` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
UPDATE `project_members` SET `role` = 'editor';--> statement-breakpoint
UPDATE `project_members`
SET `role` = 'owner'
WHERE EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `projects`.`id` = `project_members`.`project_id`
    AND `projects`.`created_by` = `project_members`.`user_id`
);
