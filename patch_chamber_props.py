import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    """        <SettingsPanel 
          isOpen={isSettingsOpen} """,
    """        <SettingsPanel 
          isProCompareEnabled={isProCompareEnabled}
          handleToggleProCompare={handleToggleProCompare}
          setIsAuditModalOpen={setIsAuditModalOpen}
          isOpen={isSettingsOpen} """
)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

