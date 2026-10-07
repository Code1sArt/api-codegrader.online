-- AlterTable
ALTER TABLE `TestCase` ADD COLUMN `subtaskId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Submission` ADD COLUMN `subtaskResults` JSON NULL;

-- CreateTable
CREATE TABLE `Subtask` (
    `id` VARCHAR(191) NOT NULL,
    `problemId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `score` DECIMAL(8, 2) NOT NULL,
    `position` INTEGER NOT NULL,

    INDEX `Subtask_problemId_idx`(`problemId`),
    UNIQUE INDEX `Subtask_problemId_position_key`(`problemId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subtask` ADD CONSTRAINT `Subtask_problemId_fkey` FOREIGN KEY (`problemId`) REFERENCES `Problem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TestCase` ADD CONSTRAINT `TestCase_subtaskId_fkey` FOREIGN KEY (`subtaskId`) REFERENCES `Subtask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
